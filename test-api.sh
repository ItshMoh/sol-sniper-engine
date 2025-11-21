#!/bin/bash

echo "🧪 Testing Solana Sniper Engine API"
echo "===================================="
echo ""

# Test 1: Health Check
echo "1️⃣ Testing Health Endpoint..."
curl -s http://localhost:3000/health | jq '.'
echo ""
echo ""

# Test 2: Submit Order
echo "2️⃣ Submitting Test Order..."
ORDER_RESPONSE=$(curl -s -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenAddress": "B2DdhSFkydrDMbeamxnVyxiZNABVPoTFJjZKzSc1G3DP",
    "amountIn": "100000000",
    "slippage": "0.01"
  }')

echo "$ORDER_RESPONSE" | jq '.'
echo ""

# Extract orderId
ORDER_ID=$(echo "$ORDER_RESPONSE" | jq -r '.orderId')
echo "✅ Order ID: $ORDER_ID"
echo ""

# Test 3: Get Order Status
echo "3️⃣ Checking Order Status..."
sleep 2
curl -s "http://localhost:3000/api/orders/$ORDER_ID" | jq '.'
echo ""

echo "===================================="
echo "✅ API Testing Complete!"
echo ""
echo "💡 To test WebSocket, use:"
echo "   WS_URL from the order response above"
