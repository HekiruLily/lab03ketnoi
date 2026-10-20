const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());

const BANK_URL = process.env.BANK_URL || 'http://localhost:4002';


const bankAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 15,
  maxFreeSockets: 15,
  timeout: 4000
});


const students = {
  '1': { id: '1', name: 'Sinh viên 1', debt: 50000000 },
  '2': { id: '2', name: 'Sinh viên 2', debt: 0 },
  '3': { id: '3', name: 'Sinh viên 3', debt: 3200000 }
};

let paymentCounter = 1;


function callBankCharge(payload, idempotencyKey, timeoutMs = 1300) {
  return new Promise((resolve, reject) => {
    const url = new URL('/charges', BANK_URL);
    const bodyData = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      agent: bankAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
        'Idempotency-Key': idempotencyKey
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (err) {
          reject(new Error('INVALID_RESPONSE'));
        }
      });
    });


    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error('Request Timeout'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(bodyData);
    req.end();
  });
}


async function chargeWithRetry(paymentId, amount) {
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_PER_ATTEMPT = 1300;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await callBankCharge(
        { reference: paymentId, amount },
        paymentId,
        TIMEOUT_PER_ATTEMPT
      );


      if (response.statusCode === 201 || (response.statusCode >= 400 && response.statusCode < 500)) {
        return { type: 'RESPONSE', statusCode: response.statusCode, body: response.body };
      }


      if (response.statusCode >= 500) {
        lastError = { code: 'HTTP_500', message: response.body.error || 'Lỗi máy chủ ngân hàng 500' };
      }
    } catch (err) {
      lastError = err;



      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        return { type: 'CONN_REFUSED', error: 'Không thể kết nối tới cổng ngân hàng' };
      }



      if (err.code === 'ETIMEDOUT') {
        return { type: 'UNCERTAIN', error: 'Hết thời gian chờ phản hồi từ ngân hàng' };
      }



    }
  }




  if (lastError && lastError.code === 'HTTP_500') {
    return { type: 'DEFINITELY_NOT_CHARGED', error: 'Ngân hàng lỗi tạm thời (500) sau nhiều lần thử' };
  }

  return { type: 'UNCERTAIN', error: 'Mất kết nối khi đang chờ trả lời từ ngân hàng' };
}


app.get('/students/:id/fees', (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }
  res.status(200).json(student);
});


app.post('/students/:id/payments', async (req, res) => {
  const student = students[req.params.id];
  if (!student) {
    return res.status(404).json({ error: 'Không tìm thấy sinh viên' });
  }

  const { amount } = req.body;
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Số tiền thanh toán không hợp lệ' });
  }

  if (amount > student.debt) {
    return res.status(400).json({ error: 'Số tiền thanh toán vượt quá công nợ hiện tại' });
  }

  const paymentId = `P${paymentCounter++}`;


  const result = await chargeWithRetry(paymentId, amount);


  if (result.type === 'RESPONSE') {
    if (result.statusCode === 201) {

      student.debt -= amount;
      return res.status(201).json({
        paymentId,
        status: 'PAID',
        amount,
        remainingDebt: student.debt,
        chargeId: result.body.chargeId
      });
    } else {

      return res.status(result.statusCode).json({
        error: result.body.error || 'Ngân hàng từ chối giao dịch',
        paymentId,
        status: 'FAILED'
      });
    }
  }

  if (result.type === 'CONN_REFUSED' || result.type === 'DEFINITELY_NOT_CHARGED') {

    return res.status(503).json({
      error: result.error,
      paymentId,
      status: 'FAILED'
    });
  }


  return res.status(504).json({
    error: result.error,
    paymentId,
    status: 'PENDING'
  });
});

const PORT = 4001;
app.listen(PORT, () => {
  console.log(`fee service đang chạy tại http://localhost:${PORT} (BANK_URL=${BANK_URL})`);
});