//  Initializing socket server architecture
const options = { cors: { origin: ["wss://rotisseriechicken.world", "wss://story.rotisseriechicken.world", "https://rotisseriechicken.world", "https://story.rotisseriechicken.world", /\.rotisseriechicken\.world$/] }};
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
 *            CONTENT:  [{The word object containing the w packet's word as a string}, waitlist time]
 *
 *      f  -  Server stating the story is finished and moving onto the next one. (EMITTED TO ALL!)
 *            CONTENT:  [The integer of the new story, The Date.now() UTC time of the next game start]
 *
 *      v  -  Update vote score of word. (EMITTED TO ALL!)
 *            CONTENT:  [The index of the word in the story array, & its new score total], both as ints.
 *
 *      A  -  Userlist update (and all in-progress words).
 *            CONTENT:  [MODE as an integer, [[UUID, prognostication], [UUID, prognostication etc]]]
 *
 *      J  -  User joined.
 *            CONTENT:  [UUID]
 *
 *      L  -  User left.
 *            CONTENT:  [UUID, Reason]
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
 *      *  -  In-progress text
 *            CLIENT:    "spaghetti", or any non-slur in-progress string < 35 chars.
 *            RESPONSE:  A packet, a variable number of times a second, with all user deltas.
 *
 *      p  -  Client lite ping. Intended as self-spin.
 *            CLIENT:    <any data>
 *            RESPONSE:  <none>
 */

// #######################################################################################
//  Server Variables
var VERSION = 2; // Server's version; Used to validate major changes with the client
var UserObject = {}; // Object of arrays: 
// socket.id: [socket object pointer, UUID, prognostication string]

var Prognostication_Delta = []; // list of UUIDs and their strings which need updating next prog cycle

var WaitList = []; // List of users that are required to wait before submitting further entries.

var STORY = []; // The story data so far
var WHICH_STORY = 0; // The number of story currently in progress
var STORY_ACTIVATE_TIME = Date.now(); // The time at which the next story will begin.

var CUTSCENE_TIME = 0; // 15000; // Server-enforced time between games (cutscene duration!)

var FLAG_SPUN_ONCE = false; // If true, the spinner has begun
var ITERATIVE_UUID = 0; // this number will be new users' iterating UUID



// #######################################################################################
//  Server functions
function updateActiveUsers(){

}

function decrementWaitlist(){
  for(var USER of WaitList){ // Each USER is formatted as [user socket ID,  words until submittable]
    USER[1]--; // Decrement
    if(USER[1] <= 0){ // User has 0 words left to wait, so they are removed from the waitlist
      WaitList.splice(WaitList.findIndex(elem => elem[0] === USER[0]), 1);
    }
  }
}

function getFullUserdata(){
  var CompiledUserdata = [];
  for(var USER in UserObject){
      CompiledUserdata.push([UserObject[USER][1],UserObject[USER][2]]);
  }
  return CompiledUserdata;
}

function updateUserdata(){

}

function currentlyOnline(){
  return Object.keys(UserObject).length;
}



// #######################################################################################
//  Client function parity
function VALIDATOR(word){ // Input word, assumed at this point to be a string
  if(word != ''){
    return [true]; // word has substance
  } else {
    return [false]; // word is nothing; reject it
  }
}

function HTMLcleanString(UNSAFE_STRING){
  var NEW_STRING = UNSAFE_STRING.trim();
  NEW_STRING = NEW_STRING.replaceAll('<','​&lt;')
                         .replaceAll('>','​&gt;');
  return NEW_STRING;
}



// #######################################################################################
//  Finally, the websocket server code
io.on("connect", socket => {

    //  On new client connecting to server
    UserObject[socket.id] = [socket, ITERATIVE_UUID, '']; // Add pointer to object referenced by array
    var GAME_MODE_NOW = 0; // In an active game
    if(Date.now() < STORY_ACTIVATE_TIME){
      GAME_MODE_NOW = 1; // Cutscene
    }
    var TUSERDATA = getFullUserdata();
    socket.emit('c', [WHICH_STORY, STORY, VERSION, ITERATIVE_UUID, GAME_MODE_NOW, [0, TUSERDATA]]);
    socket.broadcast.emit('J', [ITERATIVE_UUID]); // emit to all but joiner that a new client has joined
    console.log('O--> User ' + socket.id + ' (UUID '+ITERATIVE_UUID+') connected (' + currentlyOnline() + ' connected)');
    

    console.log(socket);  // TESTING IP CODE
    try{
      console.log(socket.handshake.address);
      console.log(socket.handshake.address.address);
      console.log(socket.handshake.address.port);
    }catch(e){console.log('FAILED TO GET HANDSHAKE ADDRESS!')}


    ITERATIVE_UUID++; // iterate UUID list

    //  On client disconnecting from server for any reason
    socket.on("disconnect", (reason) => {
      var DISCONNECTED_USER = [socket.id, parseInt(UserObject[socket.id][1])];
      socket.broadcast.emit('L', [DISCONNECTED_USER[1]]); // emit to all but joiner that this client left
      delete UserObject[socket.id];
      // UserList.splice(UserList.findIndex(elem => elem === USER), 1);
      console.log('X<-- User ' + DISCONNECTED_USER[0] + ' (UUID '+DISCONNECTED_USER[1]+') disconnected (' + currentlyOnline() + ' connected)');
    });

    //  On new prognostication update
    socket.on('*', (word) => {
      var LIMITED_WORD = HTMLcleanString(word.substring(0,35));
      UserObject[socket.id][2] = LIMITED_WORD;
      Prognostication_Delta.push([UserObject[socket.id][1], UserObject[socket.id][2]]);
      io.emit('A', [1, Prognostication_Delta]); // mode 1 for update
      // socket.broadcast.emit('A', [1, Prognostication_Delta]); // mode 1 for update
      Prognostication_Delta = [];
    });

    //  On new word from a submitter
    socket.on('w', (word) => { //  Update story--and emit new entry--if this submission passes inspection

        var CLEANWORD = '';

        try{
          if (typeof word === 'string' || word instanceof String){
            CLEANWORD = HTMLcleanString(word); // if user submitted a string, clean it first
          } // otherwise, do nothing; the CLEANWORD string will be empty, and therefore will fail
        } catch (e){
          console.log('Word error caught (possibly malicious submission): ', e);
        }

        var WaitListInd = WaitList.findIndex(elem => elem[0] === socket.id);
        if(WaitListInd == -1){ // If user is not on the waitlist,

          if(STORY_ACTIVATE_TIME <= Date.now()){

            var VALID = VALIDATOR(CLEANWORD)[0];
            if(VALID){ // and the word they submitted is valid, then submit the word

              var WORD_OBJECT = {
                word: CLEANWORD,
                by: parseInt(UserObject[socket.id][1]),
                at: Date.now(),
                votes: 0
              };

              //  Decrement the waitlist for users on it
              decrementWaitlist(); 
              var WaitlistedFor = 0; // 0 words waitlist by default

              /*

              //  If userlist is over a certain number of people, engage the waitlist respectively
              if(currentlyOnline() >= 2){ // <----- MAKE THIS NUMBER 6 AFTER TESTING #################!!!!!
                if(currentlyOnline() >= 20){
                  if(currentlyOnline() >= 100){
                    if(currentlyOnline() >= 500){
                      if(currentlyOnline() >= 2500){
                        WaitList.push([socket.id, 25]); // 2500+ users ----- 25 word waitlist
                        WaitlistedFor = 25;
                      } else {
                        WaitList.push([socket.id, 10]); // 500-2499 users -- 10 word waitlist
                        WaitlistedFor = 10;
                      }
                    } else {
                      WaitList.push([socket.id, 4]); // 100-499 users ----- 4 word waitlist
                      WaitlistedFor = 4;
                    }
                  } else {
                    WaitList.push([socket.id, 2]); // 20-99 users ---------- 2 word waitlist
                    WaitlistedFor = 2;
                  }
                } else {
                  WaitList.push([socket.id, 1]); // 6-19 users ------------- 1 word waitlist
                  WaitlistedFor = 1;
                }
              }

              */

              //  Add to story
              STORY.push(WORD_OBJECT);
              socket.broadcast.emit('+', [WORD_OBJECT]);
              socket.emit('+', [WORD_OBJECT, WaitlistedFor]);
              console.log('UUID ' + UserObject[socket.id][1] + ':  ' + CLEANWORD);

              UserObject[socket.id][2] = '';

              //  if story reaches 100 words, emit the Finished message
              if(STORY.length == 100){
                WHICH_STORY++;
                //  Insert line which calls function that submits the story to RCW endpoint here!
                STORY = [];
                console.log('>>> Story completed, beginning story ' + WHICH_STORY);
                io.emit('f', [WHICH_STORY, (Date.now() + CUTSCENE_TIME)]);
              }

            } else { // Invalid word
              socket.emit('r', [0, 0]);
            }
          } else { // The next story has not yet begun
          socket.emit('r', [2, 0]);
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
const deadusers = schedule.scheduleJob('59 * * * * *', function(){ // Every minute (agressive downspin...)
    console.log('Updating user activity...');
    updateActiveUsers();
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
client_socket.on("q", (data) => { // spin alive response
  client_socket.emit('A', '!');
});