const jwt = require('jsonwebtoken');
const fs = require('fs');
const config = require('../config');
const Logger = require('./logger');

class JWTUtils {
    static #privateKey = null;
    static #publicKey = null;

    static #loadKeys() {
        if (!this.#privateKey || !this.#publicKey) {
            try {
                this.#privateKey = fs.readFileSync(config.jwt.privateKeyPath, 'utf8');
                this.#publicKey = fs.readFileSync(config.jwt.publicKeyPath, 'utf8');
            } catch (error) {
                throw new Error('Unable to load keys for JWT');
            }
        }
        return { privateKey: this.#privateKey, publicKey: this.#publicKey };
    }

    static generateToken(pubkey, extraClaims = {}) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const payload = {
                sub: pubkey, // Subject: user's public key as identifier
                iat: now, // Issued at
                nbf: now, // Not before
                ...extraClaims
            };

            // Load RSA keys
            const privateKey = this.#loadKeys().privateKey;

            // Generate token signed with the private key
            const token = jwt.sign(payload, privateKey, {
                algorithm: config.jwt.algorithm,
                expiresIn: config.jwt.expiresIn,
                header: {
                    alg: config.jwt.algorithm,
                    typ: 'JWT'
                }
            });

            Logger.info('JWT token generated for VSS', { 
                pubkey: pubkey.substring(0, 16) + '...', 
                algorithm: config.jwt.algorithm,
                expiresIn: config.jwt.expiresIn,
                payload: payload,
                tokenPreview: token.substring(0, 50) + '...'
            });

            return token;
        } catch (error) {
            Logger.error('❌ Error generating JWT token:', error);
            throw new Error('Failed to generate authentication token');
        }
    }
}

module.exports = JWTUtils; 
