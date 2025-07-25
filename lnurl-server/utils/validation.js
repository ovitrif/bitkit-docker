const crypto = require('crypto');
const secp256k1 = require('secp256k1');
const config = require('../config');

class Validation {
    // Validate k1 parameter (32-byte hex string)
    static isValidK1(k1) {
        if (!k1 || typeof k1 !== 'string') {
            return false;
        }
        return /^[a-fA-F0-9]{64}$/.test(k1);
    }

    // Validate payment request (Lightning invoice)
    static isValidPaymentRequest(pr) {
        if (!pr || typeof pr !== 'string') {
            return false;
        }
        // Basic validation - starts with 'lnbc' for mainnet or 'lntb' for testnet
        return /^ln(bc|tb|rt)[a-zA-Z0-9]+$/.test(pr);
    }

    // Validate amount in millisatoshis
    static isValidAmount(amount) {
        const num = parseInt(amount);
        return !isNaN(num) && num > 0;
    }

    // Validate amount is within limits
    static isAmountInRange(amount, min, max) {
        const num = parseInt(amount);
        return !isNaN(num) && num >= min && num <= max;
    }

    // Validate remote node ID (33-byte hex string starting with 02 or 03)
    static isValidRemoteId(remoteId) {
        if (!remoteId || typeof remoteId !== 'string') {
            return false;
        }
        return /^0[23][a-fA-F0-9]{64}$/.test(remoteId);
    }

    // Validate payment ID (hex string)
    static isValidPaymentId(paymentId) {
        if (!paymentId || typeof paymentId !== 'string') {
            return false;
        }
        return /^[a-fA-F0-9]+$/.test(paymentId);
    }

    // Validate comment length
    static isValidComment(comment, maxLength = config.limits.commentAllowed) {
        if (!comment) {
            return true; // Comments are optional
        }
        return typeof comment === 'string' && comment.length <= maxLength;
    }

    // Validate boolean parameter
    static isValidBoolean(value) {
        if (value === undefined || value === null) {
            return true; // Optional boolean
        }
        return value === '0' || value === '1' || value === true || value === false;
    }

    // Generate random k1 challenge
    static generateK1() {
        return crypto.randomBytes(config.limits.k1Length).toString('hex');
    }

    // Generate random ID
    static generateId() {
        return crypto.randomBytes(config.limits.idLength).toString('hex');
    }

    /**
     * Validate public key format
     * @param {string} pubkey - The public key (hex string)
     * @returns {boolean} - True if valid public key format
     */
    static isValidPublicKey(pubkey) {
        try {
            if (!pubkey || typeof pubkey !== 'string') {
                return false;
            }

            // Check if it's a valid hex string of correct length (33 bytes = 66 hex chars)
            if (!/^[a-fA-F0-9]{66}$/.test(pubkey)) {
                return false;
            }

            const keyBuffer = Buffer.from(pubkey, 'hex');
            return secp256k1.publicKeyVerify(keyBuffer);
        } catch (error) {
            return false;
        }
    }

    /**
     * Validate signature format
     * @param {string} signature - The signature (DER-hex-encoded or compact hex string)
     * @returns {boolean} - True if valid signature format
     */
    static isValidSignature(signature) {
        try {
            console.log('🔍 Validating signature format:', signature?.substring(0, 20) + '...', 'length:', signature?.length);
            
            if (!signature || typeof signature !== 'string') {
                console.log('❌ Signature is null/undefined or not string');
                return false;
            }

            // Check if it's a valid hex string
            if (!/^[a-fA-F0-9]+$/.test(signature)) {
                console.log('❌ Signature is not valid hex');
                return false;
            }

            const sigBuffer = Buffer.from(signature, 'hex');
            console.log('📏 Signature buffer length:', sigBuffer.length, 'bytes');
            
            // Try to parse as DER-encoded signature
            try {
                secp256k1.signatureImport(sigBuffer);
                console.log('✅ Valid DER signature');
                return true; // Valid DER signature
            } catch (derError) {
                console.log('❌ DER parsing failed:', derError.message);
                // If DER parsing fails, check if it's compact format (64 bytes = 128 hex chars)
                if (sigBuffer.length === 64) {
                    console.log('✅ Valid compact signature');
                    return true; // Valid compact signature
                }
                console.log('❌ Invalid format - not DER and not compact, length:', sigBuffer.length);
                return false; // Invalid format
            }
        } catch (error) {
            console.log('❌ Exception in signature validation:', error);
            return false;
        }
    }

    /**
     * Verify LNURL Auth signature
     * @param {string} k1 - The challenge parameter (hex string)
     * @param {string} sig - The signature (DER-hex-encoded)
     * @param {string} key - The public key (hex string)
     * @returns {boolean} - True if signature is valid
     */
    static verifyLnurlAuthSignature(k1, sig, key) {
        try {
            console.log('🔍 Verifying LNURL Auth signature:');
            console.log('  K1:', k1);
            console.log('  Sig:', sig, 'length:', sig.length);
            console.log('  Key:', key);
            
            // Convert hex strings to buffers
            const k1Buffer = Buffer.from(k1, 'hex');
            const sigBuffer = Buffer.from(sig, 'hex');
            const keyBuffer = Buffer.from(key, 'hex');

            console.log('  Buffer lengths - k1:', k1Buffer.length, 'sig:', sigBuffer.length, 'key:', keyBuffer.length);

            // Verify the public key is valid
            if (!secp256k1.publicKeyVerify(keyBuffer)) {
                console.log('❌ Invalid public key');
                return false;
            }
            console.log('✅ Valid public key');

            // Convert DER-encoded signature to compact format for secp256k1 verification
            let compactSig;
            try {
                console.log('🔄 Attempting DER import...');
                compactSig = secp256k1.signatureImport(sigBuffer);
                console.log('✅ Successfully imported DER signature, compact length:', compactSig.length);
            } catch (derError) {
                console.log('❌ DER import failed:', derError.message);
                // If DER parsing fails, try as compact signature (backwards compatibility)
                if (sigBuffer.length === 64) {
                    console.log('🔄 Trying as compact signature...');
                    compactSig = sigBuffer;
                } else {
                    console.error('❌ Invalid signature format - not DER and not compact, length:', sigBuffer.length);
                    return false;
                }
            }

            // Verify the signature
            console.log('🔄 Verifying signature...');
            const isValid = secp256k1.ecdsaVerify(compactSig, k1Buffer, keyBuffer);
            console.log('✅ Signature verification result:', isValid);
            return isValid;
        } catch (error) {
            console.error('❌ Error verifying LNURL Auth signature:', error);
            return false;
        }
    }

    // Validate LNURL Auth request params according to LUD-04
    static validateAuthRequest(params) {
        const errors = [];

        if (!this.isValidK1(params.k1)) {
            errors.push('Invalid k1 parameter - must be 32-byte hex string');
        }
        
        // sig: required, DER-hex-encoded ECDSA signature
        if (!this.isValidSignature(params.sig)) {
            console.log('❌ Signature validation failed for:', params.sig, 'length:', params.sig?.length);
            errors.push('Invalid sig parameter - must be DER-hex-encoded ECDSA signature');
        } else {
            console.log('✅ Signature validation passed for:', params.sig?.substring(0, 20) + '...');
        }
        
        // key: required, compressed 33-byte secp256k1 public key
        if (!this.isValidPublicKey(params.key)) {
            errors.push('Invalid key parameter - must be compressed 33-byte secp256k1 public key');
        }

        // action: optional, but if present must be valid enum
        if (params.action) {
            const validActions = ['register', 'login', 'link', 'auth'];
            if (!validActions.includes(params.action)) {
                errors.push(`Invalid action parameter - must be one of: ${validActions.join(', ')}`);
            }
        }

        return errors;
    }

    // Validate LNURL channel request parameters
    static validateChannelRequest(params) {
        const errors = [];

        if (params.cancel === '1') {
            // For cancellation, only k1 is required
            if (!this.isValidK1(params.k1)) {
                errors.push('Invalid k1 parameter');
            }
        } else {
            // For channel opening, k1 and remoteid are required
            if (!this.isValidK1(params.k1)) {
                errors.push('Invalid k1 parameter');
            }
            if (!this.isValidRemoteId(params.remoteid)) {
                errors.push('Invalid remoteid parameter');
            }
            if (params.private && !this.isValidBoolean(params.private)) {
                errors.push('Invalid private parameter');
            }
        }

        return errors;
    }

    // Validate LNURL withdraw callback parameters
    static validateWithdrawCallback(params) {
        const errors = [];

        if (!this.isValidK1(params.k1)) {
            errors.push('Invalid k1 parameter');
        }
        if (!this.isValidPaymentRequest(params.pr)) {
            errors.push('Invalid payment request');
        }

        return errors;
    }

    // Validate LNURL pay callback parameters
    static validatePayCallback(params) {
        const errors = [];

        if (!this.isValidAmount(params.amount)) {
            errors.push('Invalid amount parameter');
        }
        if (params.comment && !this.isValidComment(params.comment)) {
            errors.push('Comment too long');
        }

        return errors;
    }
}

module.exports = Validation;
