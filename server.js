const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ── IN-MEMORY STORE ───────────────────────────────────────────
// For production, replace with a real database (MongoDB, PostgreSQL, etc.)
const users    = {};   // { userId: { name, bank, accNum, socketId } }
const balances = {};   // { userId: number }
const txHistory = {};  // { userId: [ ...transactions ] }

// ── HELPERS ───────────────────────────────────────────────────
function getBalance(userId) {
  return balances[userId] || 0;
}

function addTx(userId, tx) {
  if (!txHistory[userId]) txHistory[userId] = [];
  txHistory[userId].push(tx);
}

function getSocketId(userId) {
  return users[userId]?.socketId || null;
}

function emitToUser(userId, event, data) {
  const socketId = getSocketId(userId);
  if (socketId) io.to(socketId).emit(event, data);
}

// ── REST: REGISTER ────────────────────────────────────────────
// POST /api/auth/register
// Body: { userId, name, bank, accNum }
app.post('/api/auth/register', (req, res) => {
  const { userId, name, bank, accNum } = req.body;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId is required' });
  }

  // Create user if not exists, otherwise update profile info
  if (!users[userId]) {
    users[userId]   = { name, bank, accNum, socketId: null };
    balances[userId] = 0;
    txHistory[userId] = [];
    console.log(`[register] New user: ${userId}`);
  } else {
    // Update profile fields only (preserve socketId & balance)
    if (name)   users[userId].name   = name;
    if (bank)   users[userId].bank   = bank;
    if (accNum) users[userId].accNum = accNum;
    console.log(`[register] Updated profile for: ${userId}`);
  }

  res.json({
    success: true,
    userId,
    balance: getBalance(userId),
  });
});

// ── REST: GET BALANCE ─────────────────────────────────────────
// GET /api/balance/:userId
app.get('/api/balance/:userId', (req, res) => {
  const { userId } = req.params;

  if (!users[userId]) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  res.json({
    success: true,
    userId,
    balance: getBalance(userId),
    name: users[userId].name || '',
  });
});

// ── REST: GET TRANSACTION HISTORY ─────────────────────────────
// GET /api/transactions/:userId
app.get('/api/transactions/:userId', (req, res) => {
  const { userId } = req.params;

  if (!users[userId]) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  res.json({
    success: true,
    transactions: txHistory[userId] || [],
  });
});

// ── REST: ADD FUNDS ───────────────────────────────────────────
// POST /api/add-funds
// Body: { userId, amount, note }
app.post('/api/add-funds', (req, res) => {
  const { userId, amount, note } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({ success: false, error: 'userId and amount are required' });
  }

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
  }

  if (!users[userId]) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  // Credit the account
  balances[userId] = getBalance(userId) + parsed;

  const tx = {
    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'add',
    amount: parsed,
    note: note || '',
    timestamp: Date.now(),
    status: 'completed',
  };

  addTx(userId, tx);

  console.log(`[add-funds] ${userId} +₦${parsed.toLocaleString()} | balance: ₦${balances[userId].toLocaleString()}`);

  // Push real-time update to the user if connected
  emitToUser(userId, 'balance-updated', {
    balance: balances[userId],
    type: 'add',
    amount: parsed,
    note: note || '',
    tx,
  });

  res.json({
    success: true,
    newBalance: balances[userId],
    tx,
  });
});

// ── REST: SEND MONEY ──────────────────────────────────────────
// POST /api/send-money
// Body: { senderId, receiverId, senderName, amount, note, receiverBank, receiverAccNum }
app.post('/api/send-money', (req, res) => {
  const {
    senderId,
    receiverId,
    senderName,
    amount,
    note,
    receiverBank,
    receiverAccNum,
  } = req.body;

  if (!senderId || !amount) {
    return res.status(400).json({ success: false, error: 'senderId and amount are required' });
  }

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
  }

  if (!users[senderId]) {
    return res.status(404).json({ success: false, error: 'Sender not found' });
  }

  if (getBalance(senderId) < parsed) {
    return res.status(400).json({ success: false, error: 'Insufficient balance' });
  }

  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = Date.now();

  // ── DEBIT SENDER ──────────────────────────────────────────
  balances[senderId] = getBalance(senderId) - parsed;

  const senderTx = {
    id: txId,
    type: 'send',
    amount: parsed,
    note: note || '',
    recipientName: users[receiverId]?.name || 'Unknown',
    bank: receiverBank || '',
    accNum: receiverAccNum || '',
    timestamp,
    status: 'completed',
  };
  addTx(senderId, senderTx);

  // Notify sender
  emitToUser(senderId, 'transaction-completed', {
    direction: 'outgoing',
    newBalance: balances[senderId],
    tx: senderTx,
  });

  console.log(`[send] ${senderId} → ${receiverId || 'external'} ₦${parsed.toLocaleString()}`);

  // ── CREDIT RECEIVER (if registered on platform) ──────────
  if (receiverId && users[receiverId]) {
    balances[receiverId] = getBalance(receiverId) + parsed;

    const receiverTx = {
      id: txId,
      type: 'add',
      amount: parsed,
      note: note || '',
      fromName: senderName || users[senderId]?.name || 'Unknown',
      fromId: senderId,
      timestamp,
      status: 'completed',
    };
    addTx(receiverId, receiverTx);

    // Push instant credit alert to receiver
    emitToUser(receiverId, 'credit-received', {
      type: 'add',
      amount: parsed,
      from: senderName || users[senderId]?.name || 'Unknown',
      note: note || '',
      timestamp,
      newBalance: balances[receiverId],
      alert: true,
      tx: receiverTx,
    });

    console.log(`[send] Receiver ${receiverId} credited. New balance: ₦${balances[receiverId].toLocaleString()}`);
  }

  res.json({
    success: true,
    newSenderBalance: balances[senderId],
    tx: senderTx,
  });
});

// ── SOCKET.IO ─────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] Connected: ${socket.id}`);

  // Link socket to a userId
  socket.on('register-user', (userId) => {
    if (!userId) return;

    // Auto-create user record if they haven't hit /register yet
    if (!users[userId]) {
      users[userId] = { name: '', bank: '', accNum: '', socketId: socket.id };
      balances[userId] = 0;
      txHistory[userId] = [];
      console.log(`[socket] Auto-registered new user: ${userId}`);
    } else {
      users[userId].socketId = socket.id;
    }

    socket.userId = userId;
    console.log(`[socket] User ${userId} linked to socket ${socket.id}`);

    // Send current balance immediately on connect
    socket.emit('balance-synced', {
      balance: getBalance(userId),
      transactions: txHistory[userId] || [],
    });
  });

  // Manual balance refresh request
  socket.on('sync-balance', (userId) => {
    const uid = userId || socket.userId;
    if (!uid) return;
    socket.emit('balance-synced', {
      balance: getBalance(uid),
      transactions: txHistory[uid] || [],
    });
    console.log(`[socket] Synced balance for: ${uid}`);
  });

  socket.on('disconnect', () => {
    // Clear socketId but keep user data
    if (socket.userId && users[socket.userId]) {
      users[socket.userId].socketId = null;
    }
    console.log(`[socket] Disconnected: ${socket.id}`);
  });
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    connectedUsers: Object.values(users).filter(u => u.socketId).length,
    totalUsers: Object.keys(users).length,
    timestamp: Date.now(),
  });
});

// ── START ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n⚡ FlashFunds server running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});
