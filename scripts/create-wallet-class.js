// One-time script: Create the Google Wallet Generic Class
// Run: node scripts/create-wallet-class.js

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const ISSUER_ID = '3388000000023107846';
const CLASS_ID = `${ISSUER_ID}.fidelityLoyaltyClass`;

async function createClass() {
  const keyFile = path.join(__dirname, '..', 'certs', 'google', 'service-account.json');
  const credentials = JSON.parse(fs.readFileSync(keyFile, 'utf-8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });

  const client = await auth.getClient();

  // Check if class already exists
  try {
    const getRes = await client.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/genericClass/${CLASS_ID}`,
      method: 'GET',
    });
    console.log('✅ Class already exists:', CLASS_ID);
    console.log(JSON.stringify(getRes.data, null, 2));
    return;
  } catch (err) {
    if (err.response?.status !== 404) {
      console.error('Error checking class:', err.response?.data || err.message);
      return;
    }
    console.log('Class not found, creating...');
  }

  // Create class
  const classObject = {
    id: CLASS_ID,
    issuerName: 'Fidelity B2B',
    reviewStatus: 'UNDER_REVIEW',
    multipleDevicesAndHoldersAllowedStatus: 'MULTIPLE_HOLDERS',
  };

  try {
    const res = await client.request({
      url: 'https://walletobjects.googleapis.com/walletobjects/v1/genericClass',
      method: 'POST',
      data: classObject,
    });
    console.log('✅ Class created successfully!');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error('❌ Error creating class:', err.response?.data || err.message);
  }
}

createClass();
