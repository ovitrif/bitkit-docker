const express = require('express');
const router = express.Router();
const bolt11 = require('bolt11');
const lnurl = require('lnurl');

const templates = require('../templates');
const Logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

// Serve the decoder page UI
router.get('/', asyncHandler(async (req, res) => {
    const html = templates.renderDecoderPage();
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
}));

// Decode Lightning invoice endpoint
router.post('/lightning', asyncHandler(async (req, res) => {
    const { invoice } = req.body;

    if (!invoice) {
        return res.status(400).json({
            error: 'Missing invoice parameter'
        });
    }

    try {
        const decoded = bolt11.decode(invoice);
        Logger.info('Lightning invoice decoded', {
            paymentHash: decoded.paymentHash,
            amount: decoded.millisatoshis
        });

        res.json({
            success: true,
            invoice: invoice,
            decoded: {
                paymentHash: decoded.paymentHash,
                description: decoded.description,
                descriptionHash: decoded.descriptionHash,
                payeeNodeKey: decoded.payeeNodeKey,
                purpose: decoded.purpose,
                amount: decoded.millisatoshis ? {
                    millisatoshis: decoded.millisatoshis,
                    satoshis: Math.floor(decoded.millisatoshis / 1000),
                    btc: decoded.millisatoshis / 100000000000
                } : null,
                timestamp: decoded.timestamp,
                timestampString: decoded.timestampString,
                expiry: decoded.expiry,
                expiryString: decoded.timeExpireDate ? (decoded.timeExpireDate instanceof Date ? decoded.timeExpireDate.toISOString() : decoded.timeExpireDate) : null,
                minFinalCltvExpiry: decoded.minFinalCltvExpiry,
                fallbackAddresses: decoded.fallbackAddresses,
                routingInfo: decoded.routingInfo,
                features: decoded.features,
                unknownFields: decoded.unknownFields,
                signature: decoded.signature,
                network: decoded.network
            }
        });
    } catch (error) {
        Logger.error('Error decoding Lightning invoice', error);
        res.status(400).json({
            success: false,
            error: 'Invalid Lightning invoice: ' + error.message
        });
    }
}));

// Decode LNURL endpoint
router.post('/lnurl/decode', asyncHandler(async (req, res) => {
    const { lnurlString } = req.body;

    if (!lnurlString) {
        return res.status(400).json({
            error: 'Missing lnurlString parameter'
        });
    }

    try {
        const decoded = lnurl.decode(lnurlString);
        Logger.info('LNURL decoded', {
            original: lnurlString,
            decoded: decoded
        });

        res.json({
            success: true,
            lnurl: lnurlString,
            decoded: decoded
        });
    } catch (error) {
        Logger.error('Error decoding LNURL', error);
        res.status(400).json({
            success: false,
            error: 'Invalid LNURL: ' + error.message
        });
    }
}));

// Encode URL to LNURL endpoint
router.post('/lnurl/encode', asyncHandler(async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({
            error: 'Missing url parameter'
        });
    }

    try {
        // Validate URL format
        new URL(url);

        const encoded = lnurl.encode(url);
        Logger.info('URL encoded to LNURL', {
            original: url,
            encoded: encoded
        });

        res.json({
            success: true,
            url: url,
            encoded: encoded
        });
    } catch (error) {
        Logger.error('Error encoding URL to LNURL', error);
        res.status(400).json({
            success: false,
            error: 'Invalid URL or encoding error: ' + error.message
        });
    }
}));

module.exports = router;