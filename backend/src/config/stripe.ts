const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe configuration and helper functions
class StripeService {
  constructor() {
    this.stripe = stripe;
  }

  // Create payment intent for escrow
  async createPaymentIntent(amount, dealId, metadata = {}) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount), // Ensure integer
        currency: 'usd',
        transfer_group: dealId,
        capture_method: 'automatic',
        metadata: {
          dealId,
          type: 'escrow_payment',
          ...metadata
        },
        description: `Escrow payment for deal ${dealId}`
      });

      return paymentIntent;
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
  }

  // Create transfer to seller
  async createTransfer(amount, destination, dealId, metadata = {}) {
    try {
      const transfer = await this.stripe.transfers.create({
        amount: Math.round(amount),
        currency: 'usd',
        destination: destination,
        transfer_group: dealId,
        metadata: {
          dealId,
          type: 'escrow_release',
          ...metadata
        },
        description: `Escrow release for deal ${dealId}`
      });

      return transfer;
    } catch (error) {
      console.error('Error creating transfer:', error);
      throw error;
    }
  }

  // Create refund
  async createRefund(paymentIntentId, amount = null, reason = 'requested_by_customer') {
    try {
      const refundOptions = {
        payment_intent: paymentIntentId,
        reason: reason
      };

      if (amount) {
        refundOptions.amount = Math.round(amount);
      }

      const refund = await this.stripe.refunds.create(refundOptions);
      return refund;
    } catch (error) {
      console.error('Error creating refund:', error);
      throw error;
    }
  }

  // Get account info
  async getAccountInfo(accountId) {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);
      return account;
    } catch (error) {
      console.error('Error retrieving account info:', error);
      throw error;
    }
  }

  // Check if account can receive payments
  async canReceivePayments(accountId) {
    try {
      const account = await this.getAccountInfo(accountId);
      return account.charges_enabled && account.payouts_enabled;
    } catch (error) {
      return false;
    }
  }

  // Create Express account for Connect
  async createExpressAccount(email, country = 'US') {
    try {
      const account = await this.stripe.accounts.create({
        type: 'express',
        email: email,
        country: country,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      return account;
    } catch (error) {
      console.error('Error creating Express account:', error);
      throw error;
    }
  }

  // Create account link for onboarding
  async createAccountLink(accountId, refreshUrl, returnUrl) {
    try {
      const accountLink = await this.stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      return accountLink;
    } catch (error) {
      console.error('Error creating account link:', error);
      throw error;
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature, secret) {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      throw error;
    }
  }

  // Get payment intent
  async getPaymentIntent(paymentIntentId) {
    try {
      return await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      console.error('Error retrieving payment intent:', error);
      throw error;
    }
  }

  // Get transfer
  async getTransfer(transferId) {
    try {
      return await this.stripe.transfers.retrieve(transferId);
    } catch (error) {
      console.error('Error retrieving transfer:', error);
      throw error;
    }
  }

  // Calculate platform fee
  calculatePlatformFee(amount, feePercent = 3) {
    return Math.round(amount * (feePercent / 100));
  }

  // Calculate net amount after fees
  calculateNetAmount(amount, feePercent = 3) {
    return amount - this.calculatePlatformFee(amount, feePercent);
  }

  // Format amount for display
  formatAmount(amountInCents, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amountInCents / 100);
  }
}

// Export singleton instance
module.exports = new StripeService();