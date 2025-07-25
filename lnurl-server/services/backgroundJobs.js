const db = require('../database');
const lndService = require('./lnd');
const Logger = require('../utils/logger');
const config = require('../config');

class BackgroundJobs {
    constructor() {
        this.paymentCheckInterval = null;
        this.sessionCleanupInterval = null;
    }

    // Start all background jobs
    start() {
        this.startPaymentCheck();
        this.startAuthSessionCleanup();
        Logger.info('Background jobs started');
    }

    // Stop all background jobs
    stop() {
        if (this.paymentCheckInterval) {
            clearInterval(this.paymentCheckInterval);
            this.paymentCheckInterval = null;
        }
        if (this.sessionCleanupInterval) {
            clearInterval(this.sessionCleanupInterval);
            this.sessionCleanupInterval = null;
        }
        Logger.info('Background jobs stopped');
    }

    // Start payment checking job
    startPaymentCheck() {
        this.paymentCheckInterval = setInterval(async () => {
            await this.checkSettledInvoices();
        }, config.intervals.paymentCheck);

        Logger.info('Payment check job started', { interval: config.intervals.paymentCheck });
    }

    // Check for settled invoices and update payment status
    async checkSettledInvoices() {
        try {
            // Get all unpaid payments
            const payments = await db.getUnpaidPayments();

            for (const payment of payments) {
                try {
                    const invoice = await lndService.getInvoice(payment.payment_hash);

                    if (invoice.settled) {
                        await db.updatePaymentPaid(payment.id);
                        Logger.payment('marked as paid', {
                            id: payment.id,
                            amount: payment.amount_sats
                        });
                    }
                } catch (error) {
                    Logger.error(`Error checking payment ${payment.id}`, error);
                }
            }
        } catch (error) {
            Logger.error('Error in checkSettledInvoices', error);
        }
    }

    // Start auth session cleanup job
    startAuthSessionCleanup() {
        this.sessionCleanupInterval = setInterval(async () => {
            try {
                await this.cleanupExpiredAuthSessions();
            } catch (error) {
                Logger.error('Auth session cleanup error', error);
            }
        }, config.limits.cleanupInterval * 1000); // Convert to milliseconds
    }
    
    async cleanupExpiredAuthSessions() {
        try {
            const result = await db.cleanupExpiredAuthSessions();
            if (result.changes > 0) {
                Logger.info('Cleaned up expired auth sessions', { count: result.changes });
            }
        } catch (error) {
            Logger.error('Error cleaning up auth sessions', error);
        }
    }
}

module.exports = new BackgroundJobs();
