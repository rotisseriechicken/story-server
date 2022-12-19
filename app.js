//  Initializing socket server architecture
const options = { cors: { origin: "*" }};
const io = require("socket.io")(options);
const PORT = process.env.PORT || 3000;

//  Initializing socket client
var client_io = require("socket.io-client");
var client_socket = client_io.connect('https://story-server.onrender.com/', {reconnect: true});

//  Initializing spinner
const schedule = require('node-schedule');

/*
 *    Server architecture explanation
 *
 *      The server has a copy of the client's logic that determine parts of speech, 
 *      word validity (if a word can be submitted and added to the story),
 *      global logic (words inside active quotes bypass grammar and lexicon checks),
 *      and global filtration (slur prevention).
 *
 *      The server also has the master copy of the current story,
 *      and clients assume that the server's copy is the correct one,
 *      not showing their word on screen until it has been emitted by the server.
 *
 *      The packet types are as follows:
 *
 *    SERVER TO CLIENT #############################
 *
 *      c  -  Client connected to server. 
 *            CONTENT:  [The number of the current story,  The current story array, The server version]
 *
 *      +  -  Server submitted word to client. (EMITTED TO ALL!)
 *            CONTENT:  {The word object containing the w packet's word as a string}
 *
 *      f  -  Server stating the story is finished and moving onto the next one. (EMITTED TO ALL!)
 *            CONTENT:  The number of the new story as an integer.
 *
 *      v  -  Update vote score of word. (EMITTED TO ALL!)
 *            CONTENT:  [The index of the word in the story array, & its new score total], both as ints.
 *
 *      q  -  Keep-alive ping. Response is expected within 15,000 MS, or the client has disconnected.
 *            CONTENT:  "."
 *
 *      r  -  Message rejected.
 *            CONTENT:  [Rejection reason as an integer, Words until submittable (incl. 0) as an integer]
 *
 *
 *    CLIENT TO SERVER #############################    
 *
 *      w  -  Client submitted word to server.
 *            CLIENT:    'A-possibly-valid-submission-as-a-string'
 *            RESPONSE:  + packet containing {the word object}
 *
 *      i  -  Declare the client as having "upvoted" a word.
 *            CLIENT:    Index of the word in the story array as an integer.
 *            RESPONSE:  v packet containing [the word index, and new vote total] as integers.
 *
 *      d  -  Declare the client as having "downvoted" a word.
 *            CLIENT:    Index of the word in the story array as an integer.
 *            RESPONSE:  v packet containing [the word index, and new vote total] as integers.
 *
 *      u  -  Declare the client as having "unvoted" a word.
 *            CLIENT:    Index of the word in the story array as an integer.
 *            RESPONSE:  v packet containing [the word index, and new vote total] as integers.
 *
 *      A  -  Keep-alive ping. Response to server's q packet.
 *            CLIENT:    "!"
 *            RESPONSE:  <none>
 *
 *      p  -  Client lite ping. Intended as self-spin.
 *            CLIENT:    <any data>
 *            RESPONSE:  <none>
 */

// #######################################################################################
//  Server Variables
var VERSION = 1; // Server's version; Used to validate major changes with the client
var UserList = []; // List of connected users, and their user objects; Used to track cooldowns.
var WaitList = []; // List of users that are required to wait before submitting further entries.

var STORY = []; // The story data so far
var WHICH_STORY = 0; // The number of story currently in progress

var FLAG_SPUN_ONCE = false; // If true, the spinner has begun



// #######################################################################################
//  Server functions
function checkAliveUsers(){
  for(var USER of UserList){
    USER.timeout(15000).emit("q", (err) => {
      if (err) {
        // client considered disconnected
        var DISCONNECTED_USER = USER.id;
        UserList.splice(UserList.findIndex(elem => elem.id === USER.id), 1);
        console.log('User ' + DISCONNECTED_USER + ' disconnected (' + UserList.length + ' connected)');
      }
    });
  }
}

function decrementWaitlist(){
  for(var USER of WaitList){ // Each USER is formatted as [user socket ID,  words until submittable]
    USER[1]--; // Decrement
    if(USER[1] <= 0){ // User has 0 words left to wait, so they are removed from the waitlist
      WaitList.splice(WaitList.findIndex(elem => elem[0] === USER[0]), 1);
    }
  }
}


// #######################################################################################
//  Client function parity
function validateWord(word){
  return true;
}



// #######################################################################################
//  Finally, the websocket server code
io.on("connect", socket => {

    //  On new client connecting to server
    UserList.push(socket);
    console.log('User ' + socket.id + ' disconnected (' + UserList.length + ' connected)');
    socket.emit('c', [WHICH_STORY, STORY]);

    //  On new word from a submitter
    socket.on('w', (word) => { //  Update story--and emit new entry--if this submission passes inspection

        var WaitListInd = WaitList.findIndex(elem => elem[0] === socket.id);
        if(WaitListInd == -1){ // If user is not on the waitlist,

          var VALID = validateWord(word);
          if(VALID){ // and the word they submitted is valid, then submit the word

            var WORD_OBJECT = {
              word: word,
              by: socket.id,
              at: Date.now(),
              votes: 0
            }

            //  Add to story
            STORY.push(WORD_OBJECT);
            io.emit('+', WORD_OBJECT);
            console.log(word);

            //  If userlist is over a certain number of people, engage the waitlist respectively
            if(UserList.length >= 2){ // <----- MAKE THIS NUMBER 6 AFTER TESTING #################!!!!!
              if(UserList.length >= 20){
                if(UserList.length >= 100){
                  if(UserList.length >= 500){
                    if(UserList.length >= 2500){
                      WaitList.push(socket.id, 25); // 2500+ users ----- 25 word waitlist
                    } else {
                      WaitList.push(socket.id, 10); // 500-2499 users -- 10 word waitlist
                    }
                  } else {
                    WaitList.push(socket.id, 10); // 100-499 users ----- 4 word waitlist
                  }
                } else {
                  WaitList.push(socket.id, 2); // 20-99 users ---------- 2 word waitlist
                }
              } else {
                WaitList.push(socket.id, 1); // 6-19 users ------------- 1 word waitlist
              }
            }

            //  if story reaches 100 words, emit the Finished message
            if(STORY.length == 100){
              WHICH_STORY++;
              //  Insert line which calls function that submits the story to RCW endpoint here!
              STORY = [];
              console.log('>>> Story completed, beginning story ' + WHICH_STORY);
              io.emit('f', WHICH_STORY);
            }

          } else { // Invalid word
            socket.emit('r', [0, 0]);
          }
        } else { // User waitlisted
          socket.emit('r', [1, WaitList[WaitListInd][1]]);
        }
    });

    socket.on('p', (content) => {
      console.log('🔃 Spun™');
    });
});

//  Server intiialization
io.listen(PORT); // Listen on server-designated port
console.log('Server started on port ' + PORT);

//  Ping initialization
const spin = schedule.scheduleJob('59 * * * * *', function(){ // Every minute (agressive downspin...)
    console.log('🔃 Spinning...');
    checkAliveUsers();
});

//  Self-client initiailization (spinner)
client_socket.on('connect', function (socket) {
    console.log('Connected to self socket');
    if(FLAG_SPUN_ONCE == false){
      const spin = schedule.scheduleJob('59 * * * * *', function(){ // Every minute (agressive downspin...)
          console.log('🔃 Spinning...');
          client_socket.emit('p', '.');
      });
      FLAG_SPUN_ONCE = true;
    }
});