//  Initializing socket architecture
const options = { cors: { origin: "*" }};
const io = require("socket.io")(options);
const PORT = process.env.PORT || 3000;

//  Initializing spinner
const schedule = require('node-schedule');
const request = require('request');

const job = schedule.scheduleJob('*/4 * * * *', function(){ // Every 4 minutes (agressive downspin...)
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

var STORY = []; // The story data so far

io.on("connect", socket => {

    //  On connection
    socket.emit('c', 'ok');

});

io.on("w", (word) => {
    
    //  Update story--and emit new entry--if this submission passes inspection
    io.emit('+', word);

});

io.listen(PORT); // Listen on server-designated port
console.log('Server started on port ' + PORT);