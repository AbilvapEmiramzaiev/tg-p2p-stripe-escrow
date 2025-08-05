// MongoDB initialization script
// This runs when the container starts for the first time

// Switch to the application database
db = db.getSiblingDB('p2p-escrow');

// Create application user
db.createUser({
  user: 'botuser',
  pwd: 'botpassword',
  roles: [
    {
      role: 'readWrite',
      db: 'p2p-escrow'
    }
  ]
});

// Create indexes for better performance
db.users.createIndex({ "telegramId": 1 }, { unique: true });
db.users.createIndex({ "stripeAccountId": 1 });
db.users.createIndex({ "createdAt": -1 });

db.deals.createIndex({ "dealId": 1 }, { unique: true });
db.deals.createIndex({ "buyerId": 1, "status": 1 });
db.deals.createIndex({ "sellerId": 1, "status": 1 });
db.deals.createIndex({ "status": 1, "createdAt": -1 });
db.deals.createIndex({ "stripePaymentIntentId": 1 });

// Insert sample data for testing (optional)
if (db.users.countDocuments() === 0) {
  print('Inserting sample data...');
  
  // You can add sample users and deals here for testing
  // db.users.insertOne({
  //   telegramId: "123456789",
  //   username: "testuser",
  //   firstName: "Test",
  //   lastName: "User",
  //   createdAt: new Date()
  // });
}

print('MongoDB initialization completed!');