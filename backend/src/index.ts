
// =================================
// server.js - Main server entry point
// =================================

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');

const bot = require('./src/bot');
const stripeWebhooks = require('./src/webhooks/stripe');
const webRoutes = require('./src/routes/web');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Parse JSON bodies
app.use('/webhook/stripe', bodyParser.raw({ type: 'application/json' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Routes
app.use('/webhook/stripe', stripeWebhooks);
app.use('/', webRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Bot webhook: ${process.env.BOT_DOMAIN}/webhook/telegram`);
});

// Start Telegram bot
bot.launch();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// =================================
// src/models/User.js
// =================================

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  username: String,
  firstName: String,
  lastName: String,
  stripeAccountId: String,
  stripeAccountStatus: {
    type: String,
    enum: ['none', 'pending', 'active', 'restricted'],
    default: 'none'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  totalDeals: {
    type: Number,
    default: 0
  },
  successfulDeals: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);

// =================================
// src/models/Deal.js
// =================================

const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema({
  dealId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  buyerId: {
    type: String,
    required: true
  },
  sellerId: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'usd'
  },
  description: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['created', 'paid', 'completed', 'disputed', 'cancelled', 'refunded'],
    default: 'created'
  },
  stripePaymentIntentId: String,
  stripeTransferId: String,
  chatId: String,
  milestones: [{
    description: String,
    amount: Number,
    status: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending'
    },
    completedAt: Date
  }],
  disputeReason: String,
  disputedAt: Date,
  completedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Deal', dealSchema);

// =================================
// src/config/stripe.js
// =================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = stripe;

// =================================
// src/bot/index.js
// =================================

const { Telegraf, Markup } = require('telegraf');
const User = require('../models/User');
const Deal = require('../models/Deal');
const stripe = require('../config/stripe');
const { v4: uuidv4 } = require('uuid');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware to ensure user exists
bot.use(async (ctx, next) => {
  if (ctx.from) {
    let user = await User.findOne({ telegramId: ctx.from.id.toString() });
    
    if (!user) {
      user = new User({
        telegramId: ctx.from.id.toString(),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name
      });
      await user.save();
    }
    
    ctx.user = user;
  }
  return next();
});

// Start command
bot.command('start', async (ctx) => {
  const welcomeMessage = `
🤖 *Welcome to P2P Escrow Bot!*

Secure peer-to-peer transactions with Stripe escrow protection.

*Available Commands:*
/deal - Create a new deal
/mydeals - View your deals
/connect - Connect Stripe account
/balance - Check account status
/help - Show this help

*How it works:*
1. Create a deal with amount and description
2. Buyer pays via Stripe (funds held in escrow)
3. Upon milestone completion, funds are released
4. Safe and secure transactions!
  `;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔗 Connect Stripe', 'connect_stripe')],
    [Markup.button.callback('💼 Create Deal', 'create_deal')],
    [Markup.button.callback('📋 My Deals', 'my_deals')]
  ]);

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Connect Stripe account
bot.action('connect_stripe', async (ctx) => {
  if (ctx.user.stripeAccountId) {
    return ctx.editMessageText('✅ Your Stripe account is already connected!');
  }

  const authUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${process.env.STRIPE_CLIENT_ID}&scope=read_write&redirect_uri=${process.env.BOT_DOMAIN}/stripe/callback&state=${ctx.user.telegramId}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('🔗 Connect Stripe Account', authUrl)]
  ]);

  await ctx.editMessageText(
    '🔗 *Connect Your Stripe Account*\n\nTo receive payments, you need to connect your Stripe account. Click the button below to get started.',
    {
      parse_mode: 'Markdown',
      ...keyboard
    }
  );
});

// Create deal flow
bot.action('create_deal', async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.creatingDeal = { step: 'amount' };
  
  await ctx.editMessageText(
    '💰 *Create New Deal*\n\nEnter the deal amount in USD (e.g., 100.50):',
    { parse_mode: 'Markdown' }
  );
});

// Handle deal creation steps
bot.on('text', async (ctx) => {
  if (!ctx.session?.creatingDeal) return;

  const step = ctx.session.creatingDeal.step;

  switch (step) {
    case 'amount':
      const amount = parseFloat(ctx.message.text);
      if (isNaN(amount) || amount < 1) {
        return ctx.reply('❌ Please enter a valid amount (minimum $1.00)');
      }
      
      ctx.session.creatingDeal.amount = Math.round(amount * 100); // Convert to cents
      ctx.session.creatingDeal.step = 'description';
      
      await ctx.reply('📝 Enter deal description:');
      break;

    case 'description':
      ctx.session.creatingDeal.description = ctx.message.text;
      ctx.session.creatingDeal.step = 'seller';
      
      await ctx.reply('👤 Tag the seller (e.g., @username or forward their message):');
      break;

    case 'seller':
      let sellerId;
      
      if (ctx.message.forward_from) {
        sellerId = ctx.message.forward_from.id.toString();
      } else if (ctx.message.text.startsWith('@')) {
        // For demo - in production, you'd need to resolve username to ID
        await ctx.reply('❌ Please forward a message from the seller instead of using @username');
        return;
      } else {
        await ctx.reply('❌ Please forward a message from the seller or use @username');
        return;
      }

      // Check if seller has connected Stripe
      const seller = await User.findOne({ telegramId: sellerId });
      if (!seller || !seller.stripeAccountId) {
        return ctx.reply('❌ The seller needs to connect their Stripe account first. Ask them to use /start and connect Stripe.');
      }

      // Create deal
      const dealId = uuidv4().substring(0, 8);
      const deal = new Deal({
        dealId,
        buyerId: ctx.user.telegramId,
        sellerId: sellerId,
        amount: ctx.session.creatingDeal.amount,
        description: ctx.session.creatingDeal.description,
        chatId: ctx.chat.id.toString()
      });

      await deal.save();

      // Create Stripe Payment Intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: deal.amount,
        currency: 'usd',
        transfer_group: dealId,
        metadata: {
          dealId: dealId,
          buyerId: ctx.user.telegramId,
          sellerId: sellerId
        }
      });

      deal.stripePaymentIntentId = paymentIntent.id;
      await deal.save();

      // Send payment link
      const paymentUrl = `${process.env.BOT_DOMAIN}/payment/${dealId}`;
      
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('💳 Pay Now', paymentUrl)],
        [Markup.button.callback('❌ Cancel Deal', `cancel_deal_${dealId}`)]
      ]);

      await ctx.reply(
        `✅ *Deal Created!*\n\n` +
        `💼 Deal ID: \`${dealId}\`\n` +
        `💰 Amount: $${(deal.amount / 100).toFixed(2)}\n` +
        `📝 Description: ${deal.description}\n\n` +
        `Click "Pay Now" to complete the payment. Funds will be held in escrow until milestone completion.`,
        {
          parse_mode: 'Markdown',
          ...keyboard
        }
      );

      // Notify seller
      try {
        await ctx.telegram.sendMessage(
          sellerId,
          `🔔 *New Deal Request*\n\n` +
          `💼 Deal ID: \`${dealId}\`\n` +
          `💰 Amount: $${(deal.amount / 100).toFixed(2)}\n` +
          `📝 Description: ${deal.description}\n` +
          `👤 Buyer: ${ctx.user.firstName || 'Anonymous'}\n\n` +
          `Waiting for buyer payment...`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.log('Could not notify seller:', error.message);
      }

      // Clear session
      delete ctx.session.creatingDeal;
      break;
  }
});

// View deals
bot.action('my_deals', async (ctx) => {
  const deals = await Deal.find({
    $or: [
      { buyerId: ctx.user.telegramId },
      { sellerId: ctx.user.telegramId }
    ]
  }).sort({ createdAt: -1 }).limit(10);

  if (deals.length === 0) {
    return ctx.editMessageText('📭 You have no deals yet. Create your first deal with /deal');
  }

  let message = '📋 *Your Recent Deals:*\n\n';
  
  for (const deal of deals) {
    const role = deal.buyerId === ctx.user.telegramId ? 'Buyer' : 'Seller';
    const statusEmoji = {
      'created': '⏳',
      'paid': '💰',
      'completed': '✅',
      'disputed': '⚠️',
      'cancelled': '❌',
      'refunded': '🔄'
    };

    message += `${statusEmoji[deal.status]} \`${deal.dealId}\` - $${(deal.amount / 100).toFixed(2)}\n`;
    message += `   Role: ${role} | Status: ${deal.status}\n`;
    message += `   ${deal.description.substring(0, 50)}${deal.description.length > 50 ? '...' : ''}\n\n`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh', 'my_deals')],
    [Markup.button.callback('🏠 Main Menu', 'main_menu')]
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard
  });
});

// Release funds (seller action)
bot.command('release', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Usage: /release <deal_id>');
  }

  const dealId = args[1];
  const deal = await Deal.findOne({ dealId, sellerId: ctx.user.telegramId });

  if (!deal) {
    return ctx.reply('❌ Deal not found or you are not the seller.');
  }

  if (deal.status !== 'paid') {
    return ctx.reply('❌ Deal must be in "paid" status to release funds.');
  }

  try {
    // Transfer funds to seller
    const transfer = await stripe.transfers.create({
      amount: Math.round(deal.amount * 0.97), // 3% platform fee
      currency: 'usd',
      destination: ctx.user.stripeAccountId,
      transfer_group: dealId,
    });

    deal.status = 'completed';
    deal.stripeTransferId = transfer.id;
    deal.completedAt = new Date();
    await deal.save();

    // Update user stats
    await User.updateOne(
      { telegramId: ctx.user.telegramId },
      { $inc: { successfulDeals: 1 } }
    );

    await ctx.reply(
      `✅ *Funds Released!*\n\n` +
      `💼 Deal ID: \`${dealId}\`\n` +
      `💰 Amount: $${(deal.amount / 100).toFixed(2)}\n` +
      `🏦 Transfer ID: \`${transfer.id}\`\n\n` +
      `Funds have been transferred to your Stripe account.`,
      { parse_mode: 'Markdown' }
    );

    // Notify buyer
    try {
      await ctx.telegram.sendMessage(
        deal.buyerId,
        `✅ *Deal Completed!*\n\n` +
        `💼 Deal ID: \`${dealId}\`\n` +
        `💰 Amount: $${(deal.amount / 100).toFixed(2)}\n` +
        `📝 Description: ${deal.description}\n\n` +
        `The seller has confirmed completion and funds have been released.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log('Could not notify buyer:', error.message);
    }

  } catch (error) {
    console.error('Transfer error:', error);
    await ctx.reply('❌ Error processing transfer. Please contact support.');
  }
});

// Dispute command
bot.command('dispute', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply('Usage: /dispute <deal_id> <reason>');
  }

  const dealId = args[1];
  const reason = args.slice(2).join(' ');

  const deal = await Deal.findOne({
    dealId,
    $or: [
      { buyerId: ctx.user.telegramId },
      { sellerId: ctx.user.telegramId }
    ]
  });

  if (!deal) {
    return ctx.reply('❌ Deal not found or you are not part of this deal.');
  }

  if (deal.status === 'completed' || deal.status === 'disputed') {
    return ctx.reply('❌ Cannot dispute this deal in its current status.');
  }

  deal.status = 'disputed';
  deal.disputeReason = reason;
  deal.disputedAt = new Date();
  await deal.save();

  await ctx.reply(
    `⚠️ *Deal Disputed*\n\n` +
    `💼 Deal ID: \`${dealId}\`\n` +
    `📝 Reason: ${reason}\n\n` +
    `An admin will review this dispute and contact both parties.`,
    { parse_mode: 'Markdown' }
  );

  // Notify admin
  if (process.env.ADMIN_TELEGRAM_ID) {
    try {
      await ctx.telegram.sendMessage(
        process.env.ADMIN_TELEGRAM_ID,
        `🚨 *New Dispute*\n\n` +
        `💼 Deal ID: \`${dealId}\`\n` +
        `💰 Amount: $${(deal.amount / 100).toFixed(2)}\n` +
        `📝 Reason: ${reason}\n` +
        `👤 Disputed by: ${ctx.user.firstName || 'Unknown'} (${ctx.user.telegramId})\n\n` +
        `Please review and take action.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log('Could not notify admin:', error.message);
    }
  }
});

// Main menu action
bot.action('main_menu', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔗 Connect Stripe', 'connect_stripe')],
    [Markup.button.callback('💼 Create Deal', 'create_deal')],
    [Markup.button.callback('📋 My Deals', 'my_deals')]
  ]);

  await ctx.editMessageText(
    '🏠 *Main Menu*\n\nWhat would you like to do?',
    {
      parse_mode: 'Markdown',
      ...keyboard
    }
  );
});

// Help command
bot.command('help', async (ctx) => {
  const helpMessage = `
🆘 *Help & Commands*

*User Commands:*
/start - Start the bot and see main menu
/deal - Create a new escrow deal
/mydeals - View your recent deals
/connect - Connect your Stripe account
/release <deal_id> - Release funds (seller only)
/dispute <deal_id> <reason> - Dispute a deal
/help - Show this help message

*How to use:*
1. Connect your Stripe account with /connect
2. Create deals with /deal command
3. Buyer pays via secure Stripe checkout
4. Seller completes work and uses /release
5. Funds are transferred automatically

*Need help?* Contact support: @your_support_username
  `;

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

module.exports = bot;

// =================================
// src/webhooks/stripe.js
// =================================

const express = require('express');
const stripe = require('../config/stripe');
const Deal = require('../models/Deal');
const bot = require('../bot');

const router = express.Router();

router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`❌ Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function handlePaymentSucceeded(paymentIntent) {
  const deal = await Deal.findOne({ stripePaymentIntentId: paymentIntent.id });
  
  if (!deal) {
    console.log('Deal not found for payment intent:', paymentIntent.id);
    return;
  }

  deal.status = 'paid';
  await deal.save();

  // Notify both parties
  const paymentMessage = `
✅ *Payment Confirmed!*

💼 Deal ID: \`${deal.dealId}\`
💰 Amount: $${(deal.amount / 100).toFixed(2)}
📝 Description: ${deal.description}

Funds are now held in escrow. Seller can use /release ${deal.dealId} when work is completed.
  `;

  // Notify buyer
  try {
    await bot.telegram.sendMessage(deal.buyerId, paymentMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.log('Could not notify buyer:', error.message);
  }

  // Notify seller
  try {
    await bot.telegram.sendMessage(deal.sellerId, paymentMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.log('Could not notify seller:', error.message);
  }
}

async function handlePaymentFailed(paymentIntent) {
  const deal = await Deal.findOne({ stripePaymentIntentId: paymentIntent.id });
  
  if (!deal) {
    console.log('Deal not found for failed payment:', paymentIntent.id);
    return;
  }

  const failureMessage = `
❌ *Payment Failed*

💼 Deal ID: \`${deal.dealId}\`
💰 Amount: $${(deal.amount / 100).toFixed(2)}

The payment could not be processed. Please try again or contact support.
  `;

  // Notify buyer
  try {
    await bot.telegram.sendMessage(deal.buyerId, failureMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.log('Could not notify buyer:', error.message);
  }
}

module.exports = router;

// =================================
// src/routes/web.js
// =================================

const express = require('express');
const stripe = require('../config/stripe');
const Deal = require('../models/Deal');
const User = require('../models/User');

const router = express.Router();

// Stripe OAuth callback
router.get('/stripe/callback', async (req, res) => {
  const { code, state } = req.query;
  
  if (!code || !state) {
    return res.status(400).send('Missing authorization code or state');
  }

  try {
    // Exchange code for access token
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code: code,
    });

    // Update user with Stripe account ID
    await User.findOneAndUpdate(
      { telegramId: state },
      {
        stripeAccountId: response.stripe_user_id,
        stripeAccountStatus: 'active'
      }
    );

    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2>✅ Stripe Account Connected!</h2>
          <p>Your Stripe account has been successfully connected.</p>
          <p>You can now close this window and return to Telegram.</p>
          <script>window.close();</script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Stripe OAuth error:', error);
    res.status(500).send('Error connecting Stripe account');
  }
});

// Payment page
router.get('/payment/:dealId', async (req, res) => {
  const { dealId } = req.params;
  
  try {
    const deal = await Deal.findOne({ dealId });
    
    if (!deal || deal.status !== 'created') {
      return res.status(404).send('Deal not found or no longer available');
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(deal.stripePaymentIntentId);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pay for Deal ${dealId}</title>
        <script src="https://js.stripe.com/v3/"></script>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            max-width: 500px; 
            margin: 50px auto; 
            padding: 20px;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .deal-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          .amount {
            font-size: 24px;
            font-weight: bold;
            color: #28a745;
          }
          #card-element {
            padding: 12px;
            border: 1px solid #ccc;
            border-radius: 4px;
            margin: 20px 0;
          }
          #submit-button {
            background: #6772e5;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
          }
          #submit-button:hover {
            background: #5469d4;
          }
          #submit-button:disabled {
            background: #ccc;
            cursor: not-allowed;
          }
          .error {
            color: #e74c3c;
            margin-top: 10px;
          }
          .success {
            color: #28a745;
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>💳 Secure Payment</h2>
          
          <div class="deal-info">
            <h3>Deal Details</h3>
            <p><strong>Deal ID:</strong> ${deal.dealId}</p>
            <p><strong>Description:</strong> ${deal.description}</p>
            <p class="amount">Amount: $${(deal.amount / 100).toFixed(2)}</p>
          </div>

          <form id="payment-form">
            <div id="card-element">
              <!-- Stripe Elements will create form elements here -->
            </div>
            
            <button id="submit-button" type="submit">
              Pay $${(deal.amount / 100).toFixed(2)}
            </button>
            
            <div id="error-message" class="error"></div>
            <div id="success-message" class="success"></div>
          </form>

          <p style="margin-top: 20px; font-size: 12px; color: #666;">
            🔒 Secured by Stripe. Funds will be held in escrow until work completion.
          </p>`);
    } catch (e){

    }
    });