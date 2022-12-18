//  Initializing socket architecture
const options = { /* ... */ };
const io = require("socket.io")(options);
const PORT = process.env.PORT || 3000;

//  Initializing spinner
var request = require('request');
var schedule = require('node-schedule');

const job = schedule.scheduleJob('*/10 * * * *', function(){ // Every 10 minutes
    console.log('🔃 Spinning...');
    request('https://story-server.onrender.com/', function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log('🔃 Spin spunned™');
      }
    });
});

//  Server Variables
var UserList = []; // List of connected users, and their user objects
var CurrentWordId = 0; // 

io.on("connect", socket => {

    //  On connection

});

io.on("w", (word) => {
    
    //  Update story--and emit new entry--if this submission passes inspection
    io.emit('+', word);

});

io.listen(PORT); // Listen on server-designated port