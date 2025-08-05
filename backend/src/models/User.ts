const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    sparse: true // Allow null but unique if present
  },
  firstName: String,
  lastName: String,
  
  // Stripe Connect integration
  stripeAccountId: String,
  stripeAccountStatus: {
    type: String,
    enum: ['none', 'pending', 'active', 'restricted'],
    default: 'none'
  },
  
  // User status
  isActive: {
    type: Boolean,
    default: true
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  
  // Statistics
  totalDeals: {
    type: Number,
    default: 0
  },
  successfulDeals: {
    type: Number,
    default: 0
  },
  totalVolume: {
    type: Number,
    default: 0 // In cents
  },
  
  // Settings
  notifications: {
    type: Boolean,
    default: true
  },
  language: {
    type: String,
    default: 'en'
  },
  
  // Metadata
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ stripeAccountId: 1 });
userSchema.index({ totalDeals: -1 });
userSchema.index({ createdAt: -1 });

// Methods
userSchema.methods.getFullName = function() {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  return this.firstName || this.username || 'Anonymous';
};

userSchema.methods.canCreateDeals = function() {
  return this.isActive && !this.isBanned;
};

userSchema.methods.canReceivePayments = function() {
  return this.stripeAccountStatus === 'active';
};

// Static methods
userSchema.statics.findByTelegramId = function(telegramId) {
  return this.findOne({ telegramId: telegramId.toString() });
};

userSchema.statics.findActiveUsers = function() {
  return this.find({ isActive: true, isBanned: false });
};

// Pre-save middleware
userSchema.pre('save', function(next) {
  this.lastActivity = new Date();
  next();
});

module.exports = mongoose.model('User', userSchema);