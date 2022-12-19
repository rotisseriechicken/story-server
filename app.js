//  Initializing socket server architecture
const options = { cors: { origin: "*" }};
const io = require("socket.io")(options);
const PORT = process.env.PORT || 3000;

//  Initializing socket client
var client_io = require("socket.io-client");
var client_socket = client_io.connect('https://story-server.onrender.com/', {reconnect: true});

//  Initializing spinner
const schedule = require('node-schedule');

//  Server Variables
var UserList = []; // List of connected users, and their user objects
var CurrentWordId = 0; // 

var STORY = []; // The story data so far

io.on("connect", socket => {

    //  On new client connecting to server
    socket.emit('c', 'ok');

    //  On new word from a submitter
    socket.on('w', (word) => { //  Update story--and emit new entry--if this submission passes inspection
        console.log(word);
        io.emit('+', word);
    });

    socket.on('p', (content) => {
      console.log('🔃 Spun™');
    });
});

//  Server intiialization
io.listen(PORT); // Listen on server-designated port
console.log('Server started on port ' + PORT);

//  Self-client initiailization (spinner)
client_socket.on('connect', function (socket) {
    console.log('Connected to self socket');
    const job = schedule.scheduleJob('*/2 * * * *', function(){ // Every 2 minutes (agressive downspin...)
        console.log('🔃 Spinning...');
        client_socket.emit('p', '.');
    });
});