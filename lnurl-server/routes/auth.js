const express = require('express');
const router = express.Router();

const config = require('../config');
const db = require('../database');
const Validation = require('../utils/validation');
const Logger = require('../utils/logger');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

// LNURL-auth endpoint
router.get('/', asyncHandler(async (req, res) => {
    const { tag, k1, sig, key, action } = req.query;
    
    Logger.info('🔍 Auth endpoint called', { 
        tag, 
        action,
        k1: k1 ? 'present' : 'missing', 
        sig: sig ? 'present' : 'missing', 
        key: key ? 'present' : 'missing', 
        fullUrl: req.url 
    });

    // LUD-04: When wallet calls with signature (step 3)
    if (sig && key && k1) {
        Logger.info('🔍 LNURL Auth verification step', { 
            k1, 
            action,
            sig: sig.substring(0, 20) + '...', 
            key: key.substring(0, 20) + '...' 
        });

        // Validate input params
        const validationErrors = Validation.validateAuthRequest({ k1, sig, key, action });
        if (validationErrors.length > 0) {
            Logger.error('❌ Validation errors:', validationErrors);
            return res.json({
                status: 'ERROR',
                reason: validationErrors.join(', ')
            });
        }

        // Get session from db
        Logger.info('🔍 Looking up auth session for k1:', k1);
        const authSession = await db.getAuthSession(k1);
        if (!authSession) {
            Logger.error('❌ Auth session not found or expired for k1:', k1);
            return res.json({
                status: 'ERROR',
                reason: 'Invalid or expired k1'
            });
        }
        Logger.info('✅ Auth session found:', { sessionId: authSession.session_id, createdAt: authSession.created_at });

        // Verify the signature
        const isValidSignature = Validation.verifyLnurlAuthSignature(k1, sig, key);
        if (!isValidSignature) {
            Logger.warn('❌ Invalid signature for auth session', { k1, pubkey: key });
            return res.json({
                status: 'ERROR',
                reason: 'Invalid signature'
            });
        }

        await db.authenticateSession(k1, key);

        Logger.info('✅ Auth session authenticated', { 
            k1, 
            action,
            pubkey: key, 
            sessionId: authSession.session_id 
        });

        res.json({ 
            status: 'OK'
        });
    } else {
        Logger.error('❌ Invalid auth request - missing required parameters');
        return res.json({
            status: 'ERROR',
            reason: 'Missing required parameters: k1, sig, and key are required for LNURL-auth'
        });
    }
}));

// Get session status endpoint (for polling)
router.get('/session/:sessionId', asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await db.getAuthenticatedSession(sessionId);
    
    if (session) {
        res.json({
            authenticated: true,
            pubkey: session.pubkey,
            authenticated_at: session.created_at
        });
    } else {
        res.json({
            authenticated: false
        });
    }
}));

module.exports = router; 
