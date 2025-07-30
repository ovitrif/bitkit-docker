const express = require('express');
const router = express.Router();
const { encode } = require('lnurl');
const QRCode = require('qrcode');

const config = require('../config');
const db = require('../database');
const Validation = require('../utils/validation');
const Logger = require('../utils/logger');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

// Generate index page with links to all LNURL types
router.get('/', asyncHandler(async (req, res) => {
    const html = generateIndexHtml();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}));

// Generate LNURL endpoint (JSON response)
router.get('/:type', asyncHandler(async (req, res) => {
    const { type } = req.params;
    const data = await generateLnurlData(type, req.query);
    res.json(data);
}));

// Generate QR code as HTML page for browser viewing
router.get('/:type/qr', asyncHandler(async (req, res) => {
    const { type } = req.params;
    const data = await generateLnurlData(type, req.query);
    const html = generateQrHtml(type, data.qrCode);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}));

// Private helper functions

// Generate withdraw LNURL data
const generateWithdrawData = async () => {
    const url = `${config.domain}/withdraw`;
    const lnurl = encode(url);
    const qrCode = await QRCode.toDataURL(lnurl);

    return {
        url,
        lnurl,
        qrCode,
        type: 'withdraw'
    };
};

// Generate pay LNURL data
const generatePayData = async (queryParams) => {
    const { minSendable, maxSendable, commentAllowed } = queryParams;
    const paymentId = Validation.generateId();

    // Store payment configuration in database
    const minSendableValue = minSendable ? parseInt(minSendable) : config.limits.minSendable;
    const maxSendableValue = maxSendable ? parseInt(maxSendable) : config.limits.maxSendable;
    const commentAllowedValue = commentAllowed ? parseInt(commentAllowed) : config.limits.commentAllowed;

    await db.createPaymentConfig(paymentId, minSendableValue, maxSendableValue, commentAllowedValue);

    // Build URL (no query parameters needed since config is in DB)
    const paymentUrl = `${config.domain}/pay/${paymentId}`;
    const lnurl = encode(paymentUrl);
    const qrCode = await QRCode.toDataURL(lnurl);

    Logger.info('Payment config created', { paymentId, minSendable: minSendableValue, maxSendable: maxSendableValue });

    return {
        url: paymentUrl,
        lnurl,
        qrCode,
        paymentId,
        type: 'pay',
        minSendable: minSendableValue,
        maxSendable: maxSendableValue,
        commentAllowed: commentAllowedValue
    };
};

// Generate channel LNURL data
const generateChannelData = async () => {
    const channelUrl = `${config.domain}/channel`;
    const lnurl = encode(channelUrl);
    const qrCode = await QRCode.toDataURL(lnurl);

    return {
        url: channelUrl,
        lnurl,
        qrCode,
        type: 'channel'
    };
};

// Generate auth LNURL data
const generateAuthData = async (queryParams) => {
    // Generate k1 and session
    const k1 = Validation.generateK1();
    const sessionId = Validation.generateId();
    
    // Add action parameter if specified
    const action = queryParams.action;
    if (action) {
        const validActions = ['register', 'login', 'link', 'auth'];
        if (!validActions.includes(action)) {
            throw new ValidationError(`Invalid action. Must be one of: ${validActions.join(', ')}`);
        }
    }
    
    // Calculate expiration time
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + config.limits.sessionTimeout);

    // Store auth session in db
    await db.createAuthSession(sessionId, k1, expiresAt.toISOString());

    // Build auth URL
    let authUrl = `${config.domain}/auth?tag=login&k1=${k1}`;
    if (action) {
        authUrl += `&action=${action}`;
    }
    
    const lnurl = encode(authUrl);
    const qrCode = await QRCode.toDataURL(lnurl);

    const logData = { authUrl, k1, sessionId };
    const responseData = {
        url: authUrl,
        lnurl,
        qrCode,
        type: 'auth',
        k1: k1,
        sessionId: sessionId
    };

    if (action) {
        logData.action = action;
        responseData.action = action;
    }

    Logger.info('Auth LNURL generated', logData);
    return responseData;
};

// Generate LNURL data based on type
const generateLnurlData = async (type, queryParams) => {
    switch (type) {
        case 'withdraw':
            return await generateWithdrawData();
        case 'pay':
            return await generatePayData(queryParams);
        case 'channel':
            return await generateChannelData();
        case 'auth':
            return await generateAuthData(queryParams);
        default:
            throw new ValidationError('Invalid type. Use "withdraw", "pay", "channel", or "auth"');
    }
};

// Generate HTML page with QR code
const generateQrHtml = (type, qrCode) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LNURL ${type.toUpperCase()} QR Code</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background-color: #000000;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            font-family: Arial, sans-serif;
        }
        
        .qr-container {
            background-color: #ffffff;
            padding: 48px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(255, 255, 255, 0.1);
            text-align: center;
        }
        
        .qr-code {
            max-width: 100%;
            height: auto;
            border-radius: 4px;
        }
        
        .qr-title {
            color: #333333;
            margin-bottom: 16px;
            font-size: 18px;
            font-weight: 600;
        }
        
        @media (max-width: 480px) {
            .qr-container {
                padding: 32px;
                margin: 16px;
            }
        }
    </style>
</head>
<body>
    <div class="qr-container">
        <h1 class="qr-title">LNURL ${type.toUpperCase()}</h1>
        <img src="${qrCode}" alt="LNURL ${type} QR Code" class="qr-code" />
    </div>
</body>
</html>`;
};

// Generate index page with links to all LNURL generators
const generateIndexHtml = () => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LNURL Generator - Test Interface</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }
        
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 10px;
            font-size: 2.5em;
            font-weight: 700;
        }
        
        .subtitle {
            text-align: center;
            color: #666;
            margin-bottom: 40px;
            font-size: 1.1em;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        
        .card {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            border: 1px solid #e5e7eb;
        }
        
        .card h3 {
            color: #333;
            margin-bottom: 12px;
            font-size: 1.3em;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .card p {
            color: #666;
            margin-bottom: 20px;
            line-height: 1.5;
        }
        
        .links {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 500;
            font-size: 0.9em;
            transition: all 0.2s;
        }
        
        .btn-qr {
            background: #10b981;
            color: white;
        }
        
        .btn-qr:hover {
            background: #059669;
        }
        
        .btn-qr-secondary {
            background: transparent;
            color: #10b981;
            border: 1px solid #10b981;
        }
        
        .btn-qr-secondary:hover {
            background: #f0fdf4;
            color: #059669;
            border-color: #059669;
        }
        
        .btn-json {
            background: transparent;
            color: #6b7280;
            border: 1px solid #d1d5db;
        }
        
        .btn-json:hover {
            background: #f9fafb;
            color: #374151;
            border-color: #9ca3af;
        }
        
        .icon {
            font-size: 1.2em;
        }
        
        .footer {
            text-align: center;
            color: #666;
            font-size: 0.9em;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
        }
        
        .example-params {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 8px 12px;
            margin: 8px 0;
            font-family: monospace;
            font-size: 0.85em;
            color: #475569;
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 20px;
            }
            
            h1 {
                font-size: 2em;
            }
            
            .grid {
                grid-template-columns: 1fr;
            }
            
            .links {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚡ LNURL Generator</h1>
        <p class="subtitle">Test interface for generating and viewing LNURL codes</p>
        
        <div class="grid">
            <div class="card">
                <h3><span class="icon">🔐</span> LNURL-auth</h3>
                <p>Generate authentication challenges for Lightning wallets. Supports different action types for various use cases.</p>
                <div class="example-params">?action=login | register | link | auth</div>
                <div class="links">
                    <a href="/generate/auth/qr" class="btn btn-qr">📱 QR Code</a>
                    <a href="/generate/auth/qr?action=login" class="btn btn-qr-secondary">🔑 Login QR</a>
                    <a href="/generate/auth" class="btn btn-json">📄 JSON</a>
                </div>
            </div>
            
            <div class="card">
                <h3><span class="icon">💰</span> LNURL-pay</h3>
                <p>Create payment requests with customizable limits and comment support for receiving Lightning payments.</p>
                <div class="example-params">?minSendable=1000&maxSendable=100000&commentAllowed=255</div>
                <div class="links">
                    <a href="/generate/pay/qr" class="btn btn-qr">📱 QR Code</a>
                    <a href="/generate/pay/qr?maxSendable=50000" class="btn btn-qr-secondary">💵 Custom Limit</a>
                    <a href="/generate/pay" class="btn btn-json">📄 JSON</a>
                </div>
            </div>
            
            <div class="card">
                <h3><span class="icon">⬇️</span> LNURL-withdraw</h3>
                <p>Generate withdrawal links that allow users to pull sats from your Lightning node within specified limits.</p>
                <div class="example-params">Uses server default limits</div>
                <div class="links">
                    <a href="/generate/withdraw/qr" class="btn btn-qr">📱 QR Code</a>
                    <a href="/generate/withdraw" class="btn btn-json">📄 JSON</a>
                </div>
            </div>
            
            <div class="card">
                <h3><span class="icon">🔗</span> LNURL-channel</h3>
                <p>Create channel opening requests for Lightning wallets to establish payment channels with your node.</p>
                <div class="example-params">Standard channel request</div>
                <div class="links">
                    <a href="/generate/channel/qr" class="btn btn-qr">📱 QR Code</a>
                    <a href="/generate/channel" class="btn btn-json">📄 JSON</a>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Use JSON endpoints for coding, scan code from QR endpoints for testing.</p>
            <p>Server running on: <code>${config.domain}</code></p>
        </div>
    </div>
</body>
</html>`;
};

module.exports = router;
