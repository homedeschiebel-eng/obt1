// Zum Entwickeln/Testen: wie server.js, aber mit Test-Passwort „test“ und ohne Browser-Start
process.env.PT_DEV = '1';
require('./server.js');
