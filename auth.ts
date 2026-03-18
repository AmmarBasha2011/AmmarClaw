import { googleService } from './src/services/google.js';

console.log('--- AmmarClaw Google Auth ---');
console.log('Starting authentication flow...');

googleService.runAuth()
  .then(() => {
    console.log('✅ Success! Your Google account is linked.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Auth failed:', err);
    process.exit(1);
  });
