// Zum Entwickeln/Testen: Laptop-Server mit Test-Passwort „test“, ohne Browser-Start und ohne Updates
process.env.PT_DEV = '1';
process.env.PT_NO_UPDATE = '1';
require('./app-server.js');
