const express = require('express');
const router = express.Router();
const { encode } = require('lnurl');
const QRCode = require('qrcode');

const config = require('../config');
const db = require('../database');
const Validation = require('../utils/validation');
const Logger = require('../utils/logger');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

// Generate LNURL endpoint
router.get('/:type', asyncHandler(async (req, res) => {
    const { type } = req.params;
    let lnurl, qrCode;

    if (type === 'withdraw') {
        lnurl = encode(`${config.domain}/withdraw`);
        qrCode = await QRCode.toDataURL(lnurl);

        res.json({
            url: `${config.domain}/withdraw`,
            lnurl,
            qrCode,
            type: 'withdraw'
        });
    } else if (type === 'pay') {
        const { minSendable, maxSendable, commentAllowed } = req.query;
        const paymentId = Validation.generateId();

        // Store payment configuration in database
        const minSendableValue = minSendable ? parseInt(minSendable) : config.limits.minSendable;
        const maxSendableValue = maxSendable ? parseInt(maxSendable) : config.limits.maxSendable;
        const commentAllowedValue = commentAllowed ? parseInt(commentAllowed) : config.limits.commentAllowed;

        await db.createPaymentConfig(paymentId, minSendableValue, maxSendableValue, commentAllowedValue);

        // Build URL (no query parameters needed since config is in DB)
        const paymentUrl = `${config.domain}/pay/${paymentId}`;

        lnurl = encode(paymentUrl);
        qrCode = await QRCode.toDataURL(lnurl);

        Logger.info('Payment config created', { paymentId, minSendable: minSendableValue, maxSendable: maxSendableValue });

        res.json({
            url: paymentUrl,
            lnurl,
            qrCode,
            paymentId,
            type: 'pay',
            minSendable: minSendableValue,
            maxSendable: maxSendableValue,
            commentAllowed: commentAllowedValue
        });
    } else if (type === 'channel') {
        const channelUrl = `${config.domain}/channel`;
        lnurl = encode(channelUrl);
        qrCode = await QRCode.toDataURL(lnurl);

        res.json({
            url: channelUrl,
            lnurl,
            qrCode,
            type: 'channel'
        });
    } else if (type === 'auth') {
        // Generate k1 and session
        const k1 = Validation.generateK1();
        const sessionId = Validation.generateId();
        
        // Add action parameter if specified
        const action = req.query.action;
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
        
        lnurl = encode(authUrl);
        qrCode = await QRCode.toDataURL(lnurl);

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
        res.json(responseData);
    } else {
        throw new ValidationError('Invalid type. Use "withdraw", "pay", "channel", or "auth"');
    }
}));

module.exports = router;
