//  Initializing architecture
const options = { /* ... */ };
const io = require("socket.io")(options);
const PORT = process.env.PORT || 3000;

//  Server Variables
var UserList = []; // List of connected users, and their user objects
var CurrentWordId = 0; // 

io.on("connect", socket => {

    //  On connection

});

socket.on("entry", (word) => {
    
    //  Update story--and emit new entry--if this submission passes inspection
    socket.emit(word);

});

io.listen(PORT); // Listen on server-designated port