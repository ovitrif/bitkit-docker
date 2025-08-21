const express = require('express');
const router = express.Router();
const { encode } = require('lnurl');
const QRCode = require('qrcode');

const config = require('../config');
const db = require('../database');
const Validation = require('../utils/validation');
const Logger = require('../utils/logger');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

// Generate index HTML page
router.get('/', asyncHandler(async (req, res) => {
    const html = generateIndexHtml();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}));

// Generate LNURL
router.get('/:type', asyncHandler(async (req, res) => {
    const { type } = req.params;
    const data = await generateLnurl(type, req.query);
    res.json(data);
}));

// Generate QR code in HTML
router.get('/:type/qr', asyncHandler(async (req, res) => {
    const { type } = req.params;
    const data = await generateLnurl(type, req.query);
    const html = generateQrHtml(type, data.qrCode);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}));


const generateLnurl = async (type, query) => {
    switch (type) {
        case 'withdraw':
            return await generateLnurlWithdraw();
        case 'pay':
            return await generateLnurlPay(query);
        case 'channel':
            return await generateLnurlChannel();
        case 'auth':
            return await generateLnurlAuth(query);
        default:
            throw new ValidationError('Invalid type. Use "withdraw", "pay", "channel", or "auth"');
    }
};

const generateLnurlWithdraw = async () => {
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

const generateLnurlPay = async (query) => {
    const { minSendable, maxSendable, commentAllowed } = query;
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

const generateLnurlChannel = async () => {
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

const generateLnurlAuth = async (query) => {
    const { action = 'login' } = query;

    if (!Validation.isValidAuthAction(action)) {
        throw new ValidationError('Invalid action parameter');
    }

    const k1 = Validation.generateK1();
    const sessionId = Validation.generateId();

    // Calculate expiration time
    const expiresAt = Validation.calculateSessionExpiry();

    // Store session in db
    await db.createAuthSession(sessionId, k1, expiresAt.toISOString());

    // Build auth URL
    const authUrl = `${config.domain}/auth?tag=login&k1=${k1}&action=${action}`;
    
    const lnurl = encode(authUrl);
    const qrCode = await QRCode.toDataURL(lnurl);

    const responseData = {
        status: 'OK',
        url: authUrl,
        lnurl,
        qrCode,
        type: 'auth',
        k1: k1
    };

    Logger.info('LNURL-auth generated', { authUrl, k1, sessionId });
    return responseData;
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
    <title>LNURL Generator</title>
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
            max-width: 800px;
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
            margin-bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
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
        

        
        .button-group {
            display: flex;
            gap: 12px;
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
            border: none;
            cursor: pointer;
        }
        
        .btn-primary {
            background: #22c55e;
            color: white;
        }
        
        .btn-primary:hover {
            background: #16a34a;
        }
        
        .btn-secondary {
            background: transparent;
            color: #6b7280;
            border: 1px solid #d1d5db;
        }
        
        .btn-secondary:hover {
            background: #f9fafb;
            color: #374151;
            border-color: #9ca3af;
        }
        
        .btn-tertiary {
            background: transparent;
            color: #6b7280;
            border: 1px solid #d1d5db;
        }
        
        .btn-tertiary:hover {
            background: #f9fafb;
            color: #374151;
            border-color: #9ca3af;
        }
        
        .btn-danger {
            background: transparent;
            color: #6b7280;
            border: 1px solid #d1d5db;
        }
        
        .btn-danger:hover {
            background: #f9fafb;
            color: #374151;
            border-color: #9ca3af;
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
            
            .button-group {
                flex-direction: column;
            }
            
            .btn {
                justify-content: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><span class="lightning-icon">⚡</span>LNURL Generator</h1>
        </div>
        
        <div class="cards-container">
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">🔐</span>
                    <h2 class="card-title">LNURL-auth</h2>
                </div>
                <p class="card-description">Generate authentication challenges.</p>
                <div class="button-group">
                    <a href="/generate/auth/qr" class="btn btn-primary">📱 QR Code</a>
                    <a href="/generate/auth" class="btn btn-tertiary">📄 JSON</a>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">💰</span>
                    <h2 class="card-title">LNURL-pay</h2>
                </div>
                <p class="card-description">Create payment requests with custom limits for amounts and comments.</p>
                <div class="button-group">
                    <a href="/generate/pay/qr" class="btn btn-primary">📱 QR Code</a>
                    <a href="/generate/pay/qr?minSendable=250000&maxSendable=250000" class="btn btn-secondary">💰 Fixed Amount QR</a>
                    <a href="/generate/pay/qr?commentAllowed=0" class="btn btn-danger">🚫 No Comments QR</a>
                    <a href="/generate/pay" class="btn btn-tertiary">📄 JSON</a>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">⬇️</span>
                    <h2 class="card-title">LNURL-withdraw</h2>
                </div>
                <p class="card-description">Generate links to withdraw sats from the external node.</p>
                <div class="button-group">
                    <a href="/generate/withdraw/qr" class="btn btn-primary">📱 QR Code</a>
                    <a href="/generate/withdraw" class="btn btn-tertiary">📄 JSON</a>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <span class="card-icon">🔗</span>
                    <h2 class="card-title">LNURL-channel</h2>
                </div>
                <p class="card-description">Create channel opening requests to the external node.</p>
                <div class="button-group">
                    <a href="/generate/channel/qr" class="btn btn-primary">📱 QR Code</a>
                    <a href="/generate/channel" class="btn btn-tertiary">📄 JSON</a>
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
};

module.exports = router;
