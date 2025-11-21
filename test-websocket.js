import WebSocket from 'ws';

const WS_URL = 'wss://sol-sniper-engine-production.up.railway.app/api/orders/execute';

console.log('Connecting to WebSocket:', WS_URL);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ WebSocket connected!');
  console.log('Sending order...\n');

  // Send a test order
  const order = {
    tokenAddress: 'So11111111111111111111111111111111111111112',
    amountIn: '0.01',
    slippage: '5'
  };

  ws.send(JSON.stringify(order));
  console.log('📤 Sent order:', order);
});

ws.on('message', (data) => {
  console.log('\n📥 Received message:');
  try {
    const message = JSON.parse(data.toString());
    console.log(JSON.stringify(message, null, 2));
  } catch (e) {
    console.log(data.toString());
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 WebSocket closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
  process.exit(0);
});

// Auto-close after 30 seconds
setTimeout(() => {
  console.log('\n⏱️  Test timeout (30s), closing connection...');
  ws.close();
}, 30000);
