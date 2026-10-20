const FEE_URL = 'http://localhost:4001';
const BANK_URL = 'http://localhost:4002';

async function pay(studentId, amount) {
  const start = Date.now();
  const res = await fetch(`${FEE_URL}/students/${studentId}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount })
  });
  const data = await res.json();
  return { status: res.status, data, duration: Date.now() - start };
}

async function getFees(studentId) {
  const start = Date.now();
  const res = await fetch(`${FEE_URL}/students/${studentId}/fees`);
  const data = await res.json();
  return { status: res.status, data, duration: Date.now() - start };
}

async function getBankStats() {
  const res = await fetch(`${BANK_URL}/stats`);
  return res.json();
}

const mode = process.argv[2];

(async () => {
  if (mode === '2') {
    console.log('2. Bắn 20 thanh toán cùng lúc khi DELAY_MS=5000');
    const startAll = Date.now();
    const promises = Array.from({ length: 20 }, () => pay(1, 10000));

    setTimeout(async () => {
      const feeRes = await getFees(1);
      console.log(`[Đang chờ 20 lệnh] GET /students/1/fees trả ${feeRes.status} trong ${feeRes.duration}ms (Yêu cầu < 300ms)`);
    }, 500);

    const results = await Promise.all(promises);
    console.log(`20 lệnh thanh toán hoàn tất trong ${Date.now() - startAll}ms (Yêu cầu <= 4500ms)`);
    console.log('Mẫu phản hồi 1 lệnh:', results[0]);
  } 
  
  else if (mode === '3') {
    console.log('TÌNH HUỐNG 3: 200 thanh toán (10 yêu cầu cùng lúc) + Nghỉ 6s');
    await fetch(`${BANK_URL}/stats/reset`, { method: 'POST' });
    const startAll = Date.now();
    let successCount = 0;

    for (let batch = 0; batch < 20; batch++) {
      const resBatch = await Promise.all(Array.from({ length: 10 }, () => pay(1, 1000)));
      successCount += resBatch.filter(r => r.status === 201).length;
    }

    const totalTime = Date.now() - startAll;
    const stats = await getBankStats();
    console.log(`Kết quả: ${successCount}/200 thành công trong ${totalTime}ms`);
    console.log(`Bank /stats:`, stats, `(Yêu cầu connections <= 20)`);

    console.log('Đang chờ nhàn rỗi 6 giây để Bank đóng kết nối cũ...');
    await new Promise(r => setTimeout(r, 6000));

    console.log('Gửi tiếp 3 yêu cầu sau khi nghỉ 6 giây:');
    for (let i = 0; i < 3; i++) {
      const r = await pay(1, 1000);
      console.log(`  Yêu cầu #${i + 1}: HTTP ${r.status} - ${r.data.status}`);
    }
  } 
  
  else if (mode === '4') {
    console.log('4: Gửi 60 thanh toán lần lượt (1.000đ)');
    await fetch(`${BANK_URL}/stats/reset`, { method: 'POST' });
    const feeBefore = await getFees(1);
    let paidCount = 0;
    let pendingCount = 0;

    for (let i = 0; i < 60; i++) {
      const r = await pay(1, 1000);
      if (r.status === 201 && r.data.status === 'PAID') paidCount++;
      if (r.status === 504 && r.data.status === 'PENDING') pendingCount++;
    }

    const feeAfter = await getFees(1);
    const stats = await getBankStats();
    console.log(`Kết quả 60 lệnh: PAID = ${paidCount} (Yêu cầu >= 54), PENDING (504) = ${pendingCount}`);
    console.log(`Công nợ giảm: ${feeBefore.data.debt - feeAfter.data.debt}đ (Tương ứng ${paidCount * 1000}đ của lệnh PAID)`);
    console.log(`Bank /stats:`, stats, `(Yêu cầu duplicates = 0)`);
  } 
  
  else if (mode === '4c') {
    console.log('4c: Thanh toán 25.000.000đ (Vượt hạn mức)');
    await fetch(`${BANK_URL}/stats/reset`, { method: 'POST' });
    const r = await pay(1, 25000000);
    const stats = await getBankStats();
    console.log('Phản hồi:', r);
    console.log('Bank /stats:', stats, '(Yêu cầu requests = 1, không retry)');
  }
})();