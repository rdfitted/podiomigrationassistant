// Diagnostic script to check environment variables
// Run with: node check-env.js

console.log('=== Environment Variable Check ===\n');

console.log('PODIO_CLIENT_ID:', process.env.PODIO_CLIENT_ID ? `${process.env.PODIO_CLIENT_ID.substring(0, 10)}... (length: ${process.env.PODIO_CLIENT_ID.length})` : 'NOT SET');
console.log('PODIO_CLIENT_SECRET:', process.env.PODIO_CLIENT_SECRET ? `****** (length: ${process.env.PODIO_CLIENT_SECRET.length})` : 'NOT SET');
console.log('PODIO_USERNAME:', process.env.PODIO_USERNAME || 'NOT SET');
console.log('PODIO_PASSWORD:', process.env.PODIO_PASSWORD ? `****** (length: ${process.env.PODIO_PASSWORD.length})` : 'NOT SET');
console.log('PODIO_API_BASE:', process.env.PODIO_API_BASE || 'NOT SET (will use default)');

console.log('\n=== Raw Values (first/last chars) ===\n');
if (process.env.PODIO_PASSWORD) {
  const pwd = process.env.PODIO_PASSWORD;
  console.log('Password first char code:', pwd.charCodeAt(0));
  console.log('Password last char code:', pwd.charCodeAt(pwd.length - 1));
  console.log('Password has leading space?', pwd[0] === ' ');
  console.log('Password has trailing space?', pwd[pwd.length - 1] === ' ');
  console.log('Password trimmed length:', pwd.trim().length);
  console.log('Password actual length:', pwd.length);
}

console.log('\n=== Loading from .env.local ===');
console.log('Note: Node.js does NOT auto-load .env files.');
console.log('Next.js loads .env.local automatically in dev/production.');
console.log('If running this script directly, install and use dotenv package.\n');
