const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());


const DELAY_MS = Number(process.env.DELAY_MS || 0);
const FAIL_RATE = Number(process.env.FAIL_RATE || 0);
const DROP_RATE = Number(process.env.DROP_RATE || 0);


const stats = {
  connections: 0,
  requests: 0,
  charges: 0,
  duplicates: 0
};

const idempotencyStore = new Map();
const chargedReferences = new Set();
let chargeCounter = 1;


app.use(async (req, res, next) => {
  if (req.path === '/charges') {
    stats.requests++;
    if (DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }
  next();
});


app.get('/stats', (req, res) => {
  res.json(stats);
});


app.post('/stats/reset', (req, res) => {
  stats.connections = 0;
  stats.requests = 0;
  stats.charges = 0;
  stats.duplicates = 0;
  idempotencyStore.clear();
  chargedReferences.clear();
  res.json({ message: 'Đã reset stats', stats });
});


app.post('/charges', (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  const { reference, amount } = req.body;


  if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }


  if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
    const cached = idempotencyStore.get(idempotencyKey);

    if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
      return req.socket.destroy();
    }
    return res.status(cached.status).json(cached.body);
  }


  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền không hợp lệ' });
  }
  if (amount > 20000000) {
    return res.status(402).json({ error: 'Vượt hạn mức giao dịch 20.000.000đ' });
  }


  stats.charges++;
  if (chargedReferences.has(reference)) {
    stats.duplicates++;
  } else {
    chargedReferences.add(reference);
  }

  const responseData = {
    chargeId: `CH${chargeCounter++}`,
    reference,
    amount
  };

  if (idempotencyKey) {
    idempotencyStore.set(idempotencyKey, { status: 201, body: responseData });
  }


  if (DROP_RATE > 0 && Math.random() < DROP_RATE) {
    return req.socket.destroy();
  }

  return res.status(201).json(responseData);
});

const server = http.createServer(app);


server.keepAliveTimeout = 5000;


server.on('connection', (socket) => {
  stats.connections++;
  console.log(`[Bank] Kết nối TCP mới #${stats.connections}`);
});

const PORT = 4002;
server.listen(PORT, () => {
  console.log(`bank service đang chạy tại http://localhost:${PORT}`);
  console.log(`Cấu hình lỗi: DELAY_MS=${DELAY_MS}, FAIL_RATE=${FAIL_RATE}, DROP_RATE=${DROP_RATE}`);
});