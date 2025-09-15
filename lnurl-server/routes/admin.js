const express = require('express');
const router = express.Router();

const config = require('../config');
const db = require('../database');
const bitcoinService = require('../services/bitcoin');
const lndService = require('../services/lnd');
const Logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/', asyncHandler(async (req, res) => {
    const html = generateRootHtml();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}));

// Health check endpoint
router.get('/health', asyncHandler(async (req, res) => {
    const connections = await checkConnections();
    const sessions = await getSessions();

    res.json({
        status: connections.bitcoin && connections.lnd ? 'healthy' : 'unhealthy',
        lnurl_server: 'running',
        bitcoin_connected: connections.bitcoin,
        lnd_connected: connections.lnd,
        block_height: connections.blockHeight,
        lnd_info: connections.nodeInfo,
        auth_sessions: sessions,
        domain: config.domain
    });
}));

// List all payments endpoint
router.get('/payments', asyncHandler(async (req, res) => {
    const payments = await db.getAllPayments();

    res.json({
        payments: payments.map(p => ({
            id: p.id,
            amount_sats: p.amount_sats,
            description: p.description,
            comment: p.comment,
            paid: Boolean(p.paid),
            created_at: p.created_at
        }))
    });
}));

// List all withdrawals endpoint
router.get('/withdrawals', asyncHandler(async (req, res) => {
    const withdrawals = await db.getAllWithdrawals();

    res.json({
        withdrawals: withdrawals.map(w => ({
            id: w.id,
            k1: w.k1,
            amount_sats: w.amount_sats,
            used: Boolean(w.used),
            created_at: w.created_at
        }))
    });
}));

// List all channel requests endpoint
router.get('/channels', asyncHandler(async (req, res) => {
    const channels = await db.getAllChannelRequests();

    res.json({
        channels: channels.map(c => ({
            id: c.id,
            k1: c.k1,
            remote_id: c.remote_id,
            private: Boolean(c.private),
            cancelled: Boolean(c.cancelled),
            completed: Boolean(c.completed),
            created_at: c.created_at
        }))
    });
}));

// Check payment status endpoint
router.get('/payment/:paymentId/status', asyncHandler(async (req, res) => {
    const { paymentId } = req.params;

    // Get payment from database
    const payment = await db.getPayment(paymentId);
    if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
    }

    // If already marked as paid, return status
    if (payment.paid) {
        return res.json({
            paymentId,
            paid: true,
            amount_sats: payment.amount_sats,
            description: payment.description,
            comment: payment.comment,
            created_at: payment.created_at
        });
    }

    // Check with LND if invoice is settled
    try {
        const invoice = await lndService.getInvoice(payment.payment_hash);

        if (invoice.settled) {
            await db.updatePaymentPaid(paymentId);

            res.json({
                paymentId,
                paid: true,
                amount_sats: payment.amount_sats,
                description: payment.description,
                comment: payment.comment,
                created_at: payment.created_at,
                settled_at: new Date().toISOString()
            });
        } else {
            res.json({
                paymentId,
                paid: false,
                amount_sats: payment.amount_sats,
                description: payment.description,
                comment: payment.comment,
                created_at: payment.created_at
            });
        }
    } catch (lndError) {
        Logger.error('Error checking invoice status', lndError);
        res.json({
            paymentId,
            paid: false,
            amount_sats: payment.amount_sats,
            description: payment.description,
            comment: payment.comment,
            created_at: payment.created_at,
            error: 'Could not verify payment status'
        });
    }
}));

// Get new LND address for funding
router.get('/address', asyncHandler(async (req, res) => {
    const addressInfo = await lndService.getNewAddress();
    res.json(addressInfo);
}));


// List all auth sessions endpoint
router.get('/sessions', asyncHandler(async (req, res) => {
    const sessions = await db.getAllAuthSessions();

    res.json({
        sessions: sessions.map(s => ({
            id: s.id,
            k1: s.k1,
            pubkey: s.pubkey,
            authenticated: Boolean(s.authenticated),
            created_at: s.created_at,
            expires_at: s.expires_at
        }))
    });
}));


// Helper function to check connections
async function checkConnections() {
    const result = { bitcoin: false, lnd: false, error: null, blockHeight: null, nodeInfo: null };

    // Test Bitcoin connection
    try {
        const blockHeight = await bitcoinService.getBlockCount();
        Logger.connection('Bitcoin', 'connected', { blockHeight });
        result.bitcoin = true;
        result.blockHeight = blockHeight;
    } catch (error) {
        Logger.connection('Bitcoin', 'failed', { error: error.message });
        result.error = `Bitcoin: ${error.message}`;
    }

    // Test LND connection
    try {
        const nodeInfo = await lndService.getInfo();
        Logger.connection('LND', 'connected', { identity: nodeInfo.identity_pubkey });
        result.lnd = true;
        result.nodeInfo = nodeInfo;
    } catch (error) {
        Logger.connection('LND', 'failed', { error: error.message });
        if (!result.error) {
            result.error = `LND: ${error.message}`;
        } else {
            result.error += `, LND: ${error.message}`;
        }
    }

    return result;
}

// Helper to get auth sessions
async function getSessions() {
    try {
        const allSessions = await db.getAllAuthSessions();
        const now = new Date().toISOString();
        
        const activeSessions = allSessions.filter(s => s.expires_at > now);
        const authenticatedSessions = allSessions.filter(s => s.authenticated && s.expires_at > now);
        
        return {
            total_sessions: allSessions.length,
            active_sessions: activeSessions.length,
            authenticated_sessions: authenticatedSessions.length
        };
    } catch (error) {
        Logger.error('Error getting auth stats', error);
        return {
            total_sessions: 0,
            active_sessions: 0,
            authenticated_sessions: 0
        };
    }
}

const generateRootHtml = () => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LNURL Server - API Directory</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background-color: #f5f5f5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            padding: 40px 20px;
        }
        
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #333;
            font-size: 2.5rem;
            font-weight: 800;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        }
        
        .header p {
            color: #666;
            font-size: 1.1rem;
        }
        
        .lightning-icon {
            color: #f7931a;
            font-size: 2rem;
        }
        
        .cards-container {
            display: grid;
            gap: 24px;
            margin-bottom: 40px;
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .card-icon {
            font-size: 1.5rem;
        }
        
        .card-title {
            color: #333;
            font-size: 1.5rem;
            font-weight: 600;
            margin: 0;
        }
        
        .card-description {
            color: #666;
            font-size: 1rem;
            line-height: 1.5;
            margin-bottom: 24px;
        }
        
        .endpoints-list {
            display: grid;
            gap: 8px;
        }
        
        .endpoint {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 12px;
            background: #f9fafb;
            border-radius: 6px;
            border-left: 3px solid #22c55e;
            border: 1px solid #e5e7eb;
        }
        
        .endpoint-method {
            font-weight: 600;
            font-size: 0.75rem;
            color: #22c55e;
            min-width: 35px;
        }
        
        .endpoint-path {
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.875rem;
            color: #333;
            text-decoration: none;
            flex: 1;
        }
        
        .endpoint-path:hover {
            color: #22c55e;
        }
        
        .endpoint-desc {
            color: #666;
            font-size: 0.8rem;
        }
        
        .quick-actions {
            background: white;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .quick-actions h3 {
            color: #333;
            margin-bottom: 16px;
            font-size: 1.2rem;
        }
        
        .btn-group {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 20px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 500;
            font-size: 0.875rem;
            transition: all 0.2s ease;
        }
        
        .btn-primary {
            background: #22c55e;
            color: white;
        }
        
        .btn-primary:hover {
            background: #16a34a;
        }
        
        .btn-secondary {
            background: #3b82f6;
            color: white;
        }
        
        .btn-secondary:hover {
            background: #2563eb;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 20px 16px;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .card {
                padding: 24px;
            }
            
            .btn-group {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><span class="lightning-icon">⚡</span>LNURL Server</h1>
        </div>
        
        <div class="cards-container">
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">🏗️</span>
                    <h2 class="card-title">Generate</h2>
                </div>
                <div class="endpoints-list">
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/generate" class="endpoint-path">/generate</a>
                        <span class="endpoint-desc">Interactive generator UI</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/generate/auth" class="endpoint-path">/generate/auth</a>
                        <span class="endpoint-desc">Generate LNURL-auth</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/generate/pay" class="endpoint-path">/generate/pay</a>
                        <span class="endpoint-desc">Generate LNURL-pay</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/generate/withdraw" class="endpoint-path">/generate/withdraw</a>
                        <span class="endpoint-desc">Generate LNURL-withdraw</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/generate/channel" class="endpoint-path">/generate/channel</a>
                        <span class="endpoint-desc">Generate LNURL-channel</span>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">⚡</span>
                    <h2 class="card-title">LNURL</h2>
                </div>
                <div class="endpoints-list">
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <span class="endpoint-path">/auth</span>
                        <span class="endpoint-desc">LNURL-auth callback</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <span class="endpoint-path">/withdraw</span>
                        <span class="endpoint-desc">LNURL-withdraw callback</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <span class="endpoint-path">/pay/:id</span>
                        <span class="endpoint-desc">LNURL-pay callback</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <span class="endpoint-path">/channel</span>
                        <span class="endpoint-desc">LNURL-channel callback</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <span class="endpoint-path">/.well-known/lnurlp/:username</span>
                        <span class="endpoint-desc">Lightning Address support</span>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">📊</span>
                    <h2 class="card-title">Admin</h2>
                </div>
                <div class="endpoints-list">
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/health" class="endpoint-path">/health</a>
                        <span class="endpoint-desc">Service health check</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/payments" class="endpoint-path">/payments</a>
                        <span class="endpoint-desc">List all payments</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/withdrawals" class="endpoint-path">/withdrawals</a>
                        <span class="endpoint-desc">List all withdrawals</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/channels" class="endpoint-path">/channels</a>
                        <span class="endpoint-desc">List channel requests</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/sessions" class="endpoint-path">/sessions</a>
                        <span class="endpoint-desc">List auth sessions</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <a href="/address" class="endpoint-path">/address</a>
                        <span class="endpoint-desc">Get LND funding address</span>
                    </div>
                    <div class="endpoint">
                        <span class="endpoint-method">GET</span>
                        <span class="endpoint-path">/payment/:id/status</span>
                        <span class="endpoint-desc">Check payment status</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
};

module.exports = router; 
