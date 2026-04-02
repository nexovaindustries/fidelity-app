require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  apple: {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER,
    teamIdentifier: process.env.APPLE_TEAM_IDENTIFIER,
    wwdrPath: process.env.APPLE_WWDR_CERT_PATH,
    signerCertPath: process.env.APPLE_SIGNER_CERT_PATH,
    signerKeyPath: process.env.APPLE_SIGNER_KEY_PATH,
    signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASSPHRASE,
  },
  google: {
    issuerId: process.env.GOOGLE_ISSUER_ID,
    classId: process.env.GOOGLE_CLASS_ID,
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  }
};
