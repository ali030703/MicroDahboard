// Purpose: Starts the Express API server using the backend app configuration.
require('dotenv').config({ path: require('path').join(__dirname, '.env') }); // Load .env file at startup

const { app } = require('./src/app'); //import the app from the app.js file
const { PORT } = require('./src/config/constants'); //import the PORT from the constants.js file

const server = app.listen(PORT, () => { //start the server and listen on the specified PORT
  console.log(`API running on http://localhost:${PORT}`);
});

server.on('error', (error) => {
  console.error('API server failed to start:', error);
  process.exitCode = 1;
});
