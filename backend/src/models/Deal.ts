const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending'
  },
  completedAt: Date
});

const dealSchema = new mongoose.Schema({
  dealId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Participants
  buyerId: {
    type: String,
    required: true,
    index: true
  },
  sellerId: {
    type: String,
    required: true,
    index: true
  },
  
  // Deal details
  amount: {
    type: Number,
    required: true,
    min: 100 // Minimum $1.00 in cents
  },
  currency: {
    type: String,
    default: 'usd',
    uppercase: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 500
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['created', 'paid', 'completed', 'disputed', 'cancelled', 'refunded'],
    default: 'created',
    index: true
  },
  
  // Stripe integration
  stripePaymentIntentId: String,
  stripeTransferId: String,
  
  // Platform fee (3% default)
  platformFeePercent: {
    type: Number,
    default: 3,
    min: 0,
    max: 10
  },
  
  // Chat context
  chatId: String,
  messageId: String,
  
  // Milestones support
  milestones: [milestoneSchema],
  
  // Dispute handling
  disputeReason: String,
  disputedBy: String, // 'buyer' or 'seller'
  disputedAt: Date,
  adminNotes: String,
  
  // Completion tracking
  completedAt: Date,
  cancelledAt: Date,
  refundedAt: Date,
  
  // Metadata
  metadata: {
    type: Map,
    of: String
  }
}, {
  timestamps: true
});

// Indexes for queries
dealSchema.index({ buyerId: 1, status: 1 });
dealSchema.index({ sellerId: 1, status: 1 });
dealSchema.index({ status: 1, createdAt: -1 });
dealSchema.index({ createdAt: -1 });

// Virtual for net amount (after platform fee)
dealSchema.virtual('netAmount').get(function() {
  const feeAmount = Math.round(this.amount * (this.platformFeePercent / 100));
  return this.amount - feeAmount;
});

dealSchema.virtual('platformFeeAmount').get(function() {
  return Math.round(this.amount * (this.platformFeePercent / 100));
});

// Methods
dealSchema.methods.canBePaid = function() {
  return this.status === 'created';
};

dealSchema.methods.canBeCompleted = function() {
  return this.status === 'paid';
};

dealSchema.methods.canBeDisputed = function() {
  return ['paid'].includes(this.status);
};

dealSchema.methods.canBeCancelled = function() {
  return ['created'].includes(this.status);
};

dealSchema.methods.isParticipant = function(telegramId) {
  return this.buyerId === telegramId.toString() || this.sellerId === telegramId.toString();
};

dealSchema.methods.isBuyer = function(telegramId) {
  return this.buyerId === telegramId.toString();
};

dealSchema.methods.isSeller = function(telegramId) {
  return this.sellerId === telegramId.toString();
};

dealSchema.methods.getFormattedAmount = function() {
  return `$${(this.amount / 100).toFixed(2)}`;
};

dealSchema.methods.getFormattedNetAmount = function() {
  return `$${(this.netAmount / 100).toFixed(2)}`;
};

dealSchema.methods.getStatusEmoji = function() {
  const statusEmojis = {
    'created': '⏳',
    'paid': '💰',
    'completed': '✅',
    'disputed': '⚠️',
    'cancelled': '❌',
    'refunded': '🔄'
  };
  return statusEmojis[this.status] || '❓';
};

// Static methods
dealSchema.statics.findByDealId = function(dealId) {
  return this.findOne({ dealId });
};

dealSchema.statics.findUserDeals = function(telegramId, limit = 10) {
  return this.find({
    $or: [
      { buyerId: telegramId.toString() },
      { sellerId: telegramId.toString() }
    ]
  })
  .sort({ createdAt: -1 })
  .limit(limit);
};

dealSchema.statics.findActiveDeals = function() {
  return this.find({
    status: { $in: ['created', 'paid'] }
  });
};

dealSchema.statics.findDisputedDeals = function() {
  return this.find({ status: 'disputed' })
    .sort({ disputedAt: -1 });
};

// Pre-save middleware
dealSchema.pre('save', function(next) {
  // Auto-generate dealId if not provided
  if (!this.dealId) {
    this.dealId = require('uuid').v4().substring(0, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Deal', dealSchema);