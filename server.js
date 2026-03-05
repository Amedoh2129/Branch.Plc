const express = require('express');
const app = express();

app.use(express.json());

// Serve your HTML file
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// API endpoint - Add funds
app.post('/api/add-funds', (req, res) => {
  const { amount, userId } = req.body;
  // Process the transaction
  res.json({ success: true, newBalance: amount });
});

// API endpoint - Send money
app.post('/api/send-money', (req, res) => {
  const { amount, receiver, bank } = req.body;
  // Process transfer
  res.json({ success: true, message: 'Transfer successful' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
