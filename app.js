//  Initializing socket server architecture
const options = { cors: { origin: ["wss://rotisseriechicken.world", "wss://story.rotisseriechicken.world", "https://rotisseriechicken.world", "https://story.rotisseriechicken.world", /\.rotisseriechicken\.world$/] }};
const io = require("socket.io")(options);
const PORT = process.env.PORT || 3000;

//  Initializing HTTP GET client, and the Fetch module
const request = require('request');

//  Initializing socket client
var client_io = require("socket.io-client");
var client_socket = client_io.connect('https://story-server.onrender.com/', {reconnect: true});

//  Initializing spinner
const schedule = require('node-schedule');

//  Initialize music parser and fetching
import { parseBuffer } from 'music-metadata';
import fetch from 'node-fetch';

//  Initialize compression
var lzutf8 = require('lzutf8');

// Static outbound server IPs
var SERVER_IPS = ['3.134.238.10', '3.129.111.220', '52.15.118.168'];

//  Prerequisite variables
var WHICH_STORY = 0; // story index
var SERVER_INITIALIZED = false; // if user submissions can be accepted
var STORY_INDEX_RETRIEVED = false; // if the story index is synced with Chicken HQ
var RESUBMIT_WAIT_TIME = 5000; // time to wait before retrying requests

//  Require a request of the most recent story from Chicken headquarters
function requestWhichStory(){
  request('https://rotisseriechicken.world/story/stories/api/current', function (error, response, body) {
    if(response.statusCode == 200){ // perceived success
      console.log('WHICH_STORY retrieved: ' + parseInt(body) + '. ', response && response.statusCode);
      WHICH_STORY = parseInt(body); //  use the HTML body to set the WHICH_STORY value
      STORY_INDEX_RETRIEVED = true;
      SERVER_INITIALIZED = true;
    } else {
      console.log('WHICH_STORY error!');
      console.log(error);
      console.log('BODY:');
      console.log(body);
      setTimeout(function() {
        requestWhichStory(); // continue to force-check until the value was retrieved successfully
      }, RESUBMIT_WAIT_TIME);
    }
  });
}

requestWhichStory(); // Begin initialization of picking up wherever the server left off

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
 *      t  -  Server stating it is time to title the story, and a list of users that can title it. (EMITTED TO ALL!)
 *            CONTENT:  [[List of UUIDs which can still submit to the title], Date.now() + 20 seconds]
 *
 *      s  -  Server sending a title word to all clients (EMITTED TO ALL!)
 *            CONTENT:  [{The word object containing the w packet's word as a string}]
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
var VERSION = 5; // Server's version; Used to validate major changes with the client
var UserObject = {}; // Object of arrays: 
// socket.id: [socket object pointer, UUID, prognostication string, IP]

var UserIPs = {}; // IP: [[UUID, socket.id, last login's Date.now], etc.]  (UUID never changes in-object)
var ConnectionsPerIP = {}; // IP:  Active Connections (INT)

var WaitList = []; // List of users that are required to wait before submitting further entries.
var Prognostication_Delta = []; // list of UUIDs and their strings which need updating next prog cycle

var STORY = []; // The story data so far
var STORY_MODE = 0;
var STORY_TITLE = []; // The story's title, one word per top 5 contributors
var STORY_TOP_CONTRIBUTORS = []; // Contributors which can still submit to the title (pop()s on submission)
var STORY_ACTIVATE_TIME = Date.now(); // The time at which the next story will begin.
var TITLE_END_TIME = Date.now(); // The time at which the titling process will end.

var CUTSCENE_TIME = 40000; // 15000; // Server-enforced time between games (cutscene duration!) 

var FLAG_SPUN_ONCE = false; // If true, the spinner has begun
var ITERATIVE_UUID = 0; // this number will be new users' iterating UUID
var TIMEOUT_ELAPSE_CHECK_NUM = 0; // if this number is the same after titling timeout, auto-submit story

var MINIMUM_SESSION_DURATION_MINS = 30; // In (this number) of minutes, users' UUIDs may be lost.




// #######################################################################################
//  Server functions
function cleanUsers(){ // Function called each hour to allow users a new "session" and UUID for their IP
  var IPS_PURGED = [];
  var UUIDs_PURGED = [];
  for(var IP in ConnectionsPerIP){
    if(ConnectionsPerIP[IP] == 0){
      //  Nobody is connected on this IP right now; Consider if any, or all, users need to die
      for(var USER of UserIPs[IP]){ // NOTE: Using the IP property names to iterate the UserIPs object!
        if((parseInt(Date.now()) - parseInt(USER[2])) > (1000 * 60 * MINIMUM_SESSION_DURATION_MINS)){
          var UserArray = Array.from(USER);
          UUIDs_PURGED.push(UserArray); // Log deletion
          // clear memory for this user
          UserIPs[IP][USER] = undefined;
          delete UserIPs[IP][USER];
        }
      }
      //  If nobody remains on this IP, free the IP entirely
      if(UserIPs[IP].length == 0){
        IPS_PURGED.push(IP);
        //  clear memory for this IP and user container
        UserIPs[IP] = undefined;
        ConnectionsPerIP[IP] = undefined;
        delete UserIPs[IP];
        delete ConnectionsPerIP[IP];
      }
    }
  }
  if(IPS_PURGED.length != 0){
    console.log(IPS_PURGED);
    console.log('Purged '+IPS_PURGED.length+' IPs from ConnectionsPerIP');
  }
  if(UUIDs_PURGED.length != 0){
    console.log(UUIDs_PURGED);
    console.log('Purged '+UUIDs_PURGED.length+' User UUID bindings from UserIPs');
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

function getFullUserdata(){
  var CompiledUserdata = [];
  for(var USER in UserObject){
      CompiledUserdata.push([UserObject[USER][1],UserObject[USER][2]]);
  }
  return CompiledUserdata;
}

function currentlyOnline(){
  return Object.keys(UserObject).length;
}

function conjugateWord(STRING, WORD, PREVIOUS_WORD, IND){
  var NEWSTRING = STRING;
  var LEADING_SPACE = ' '; // leading space
  if(WORD[0].match(/^[.,:;!?)']/) || IND == 0){
    LEADING_SPACE = '';
  } else if(PREVIOUS_WORD == '(' || PREVIOUS_WORD == '"'){
    LEADING_SPACE = '';
  }
  NEWSTRING += (LEADING_SPACE + WORD);
  return NEWSTRING;
}

function conjugateStoryOrTitleForXWords(STORY_OBJECT, NUM_WORDS){
  var CONJ = '';
  for(var i=0; i<NUM_WORDS; i++){
    var PREVWORD = '';
    if(typeof STORY_OBJECT[i-1] != 'undefined'){
      PREVWORD = STORY_OBJECT[i-1].word; 
    }
    CONJ = conjugateWord(CONJ, STORY_OBJECT[i].word, PREVWORD, i);
  }
  return CONJ;
}

function determineTopContributors(){
  var numbers = [];
  for(var WORD of STORY){
    numbers.push(parseInt(WORD.by));
  }
  const frequency = {};
  for (const num of numbers) {
    if (frequency[num]) {
      frequency[num] += 1;
    } else {
      frequency[num] = 1;
    }
  }
  const sortedFrequency = Object.entries(frequency).sort((a, b) => b[1] - a[1]);
  var ARR = sortedFrequency.slice(0, 5).map(entry => entry[0]);
  var ARR_INTS = [];
  for(var NUM of ARR){
    ARR_INTS.push(parseInt(NUM));
  }
  return ARR_INTS;
}

async function getTTS(url) {
  try{
    const response = await fetch(url); // get the TTS from the internet
    if(response.ok){
      const buffer = await response.buffer();
      const metadata = await parseBuffer(buffer, 'audio/mp3', { native: true });
      const duration = metadata.format.duration;
      return [response, duration];
    } else {
      console.log('Response was not OK! Response:');
      console.log(response);
      return [-1, 0]; // response was invalid or never returned
    }
  } catch(e){
    console.log('Error in TTS!');
    console.log(e);
    return [-1, 0];
  }
}

function getCompressedStory(){
  var WORD_ARRAY = [];
  var BY_ARRAY = [];
  var AT_ARRAY = [];
  var VOTE_ARRAY = [];
  var FIRST_WORDS = conjugateStoryOrTitleForXWords(STORY, 8);
  var TITLE = conjugateStoryOrTitleForXWords(STORY_TITLE, STORY_TITLE.length);
  for(var i=0; i<STORY.length; i++){
    WORD_ARRAY.push(STORY[i].word);
    BY_ARRAY.push(STORY[i].by);
    AT_ARRAY.push(STORY[i].at);
    VOTE_ARRAY.push(STORY[i].votes); 
  }
  var PRECOMPRESSED_STORY_OBJECT = {
    words: WORD_ARRAY,
    authors: BY_ARRAY,
    times: AT_ARRAY,
    votes: VOTE_ARRAY
  };

  var STRINGIFIED_STORY = JSON.stringify(PRECOMPRESSED_STORY_OBJECT);
  var COMPRESSED_STORY = lzutf8.compress(STRINGIFIED_STORY, {outputEncoding: "Base64"});

  return [COMPRESSED_STORY, FIRST_WORDS, TITLE];
}

function timeoutSubmission(TO_CHECK){
  if(TO_CHECK == TIMEOUT_ELAPSE_CHECK_NUM){
    STORY_MODE = 0;
    console.log('>>> Timeout elapsed, submitting story...');
    submitStory(io);
  }
}

async function negotiateFinalization(TITLESTRING, STORYSTRING, IO_REFERENCE){

  var TITLE_REQUEST = 'https://api.streamelements.com/kappa/v2/speech?voice=Matthew&text=' + encodeURIComponent('The story of ' + TITLESTRING);
  var STORY_REQUEST = 'https://api.streamelements.com/kappa/v2/speech?voice=Matthew&text=' + encodeURIComponent(STORYSTRING);

  console.log('Title request: ' + TITLE_REQUEST);
  console.log('Story request: ' + STORY_REQUEST);

  //  Bake TTS as data to send to all clients
  var TITLE_AUDIO_OBJ = await getTTS(TITLE_REQUEST);
  var STORY_AUDIO_OBJ = await getTTS(STORY_REQUEST);

  var TITLE_AUDIO = TITLE_AUDIO_OBJ[0]; // The raw response objects for the stories
  var STORY_AUDIO = STORY_AUDIO_OBJ[0];
  var TITLE_AUDIO_DURATION = TITLE_AUDIO_OBJ[1]; // The duration of each story file
  var STORY_AUDIO_DURATION = STORY_AUDIO_OBJ[1]; 

  var TOTAL_DURATION = parseInt(TITLE_AUDIO_DURATION * 1000) + parseInt(STORY_AUDIO_DURATION * 1000) + 1500; // Average TTS request coordination is ~1000

  //  And now, with TTS baked, emit this to all clients
  console.log('Scheduling story #'+(WHICH_STORY + 1)+' for '+Date.now()+' + '+TOTAL_DURATION+'...');
  WHICH_STORY++;
  STORY = [];
  STORY_TITLE = [];
  STORY_TOP_CONTRIBUTORS = [];
  STORY_ACTIVATE_TIME = (Date.now() + TOTAL_DURATION);
  IO_REFERENCE.emit('f', [WHICH_STORY, STORY_ACTIVATE_TIME, [STORY_ACTIVATE_TIME, Date.now()], [TITLE_AUDIO_OBJ, STORY_AUDIO_OBJ]]);
}

async function submitStory(IO_REFERENCE){
  TIMEOUT_ELAPSE_CHECK_NUM++;
  var COMPRESSED_STORY = getCompressedStory();
  const FORM_DATA = { // create the template form data object for this submission
    story: COMPRESSED_STORY[0],
    beginsWith: COMPRESSED_STORY[1], 
    title: COMPRESSED_STORY[2],
    started: STORY_ACTIVATE_TIME,
    completed: Date.now(), 
    ver: VERSION
  };
  var FULL_STORY_AS_STRING = conjugateStoryOrTitleForXWords(STORY, STORY.length);
  console.log('STORY: '); console.log(FORM_DATA);
  request.post( // submit the story to Chicken HQ's server
    'https://rotisseriechicken.world/story/stories/api/submit.php',
    {json: FORM_DATA},
    function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log('Story submission returned 200 status');
        console.log('body:');
        console.log(body);
          if(body == 'ok'){
            console.log('STORY #' + WHICH_STORY + ' successfully submitted! Cooking TTS...');

            negotiateFinalization(COMPRESSED_STORY[2], FULL_STORY_AS_STRING, IO_REFERENCE); // Finalize story in a separate async function

          } else {
            console.log('Body of Story submission DID NOT return "ok"! re-attempting...');
            setTimeout(function() {
              submitStory(IO_REFERENCE);
            }, RESUBMIT_WAIT_TIME);
          }
      } else {
        console('STORY SUBMISSION FAILED! re-attempting...');
        setTimeout(function() {
          submitStory(IO_REFERENCE);
        }, RESUBMIT_WAIT_TIME);
      }
    }
  );
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
    var USER_IP = 'unknown';
    try{
      USER_IP = socket.handshake.headers['true-client-ip'];
    }catch(e){console.log('FAILED TO GET HANDSHAKE ADDRESS!')}
    if(SERVER_IPS.includes(USER_IP)){
      console.log('<--> Server spinner instance connected on IP ' + USER_IP);
    } else {
      //  compile user data
      var This_UID = ITERATIVE_UUID;
      var Do_not_iterate_UUID = false;
      var rePrefix = '';
      if(typeof ConnectionsPerIP[USER_IP] == 'undefined'){ // Nobody has connected from this IP yet
        //  Create an IP reference for this user's IP
        ConnectionsPerIP[USER_IP] = 1;
        // This is now this user's UUID until reset
        UserIPs[USER_IP] = [];
        UserIPs[USER_IP][(ConnectionsPerIP[USER_IP] - 1)] = [ITERATIVE_UUID, socket.id, Date.now()];
      } else { // Somebody has connected from this IP, but this could be them or someone new
        ConnectionsPerIP[USER_IP] = (parseInt(ConnectionsPerIP[USER_IP]) + 1);
        console.log('Refacilitating IP ' + USER_IP + ' connection #' + ConnectionsPerIP[USER_IP] + '...');
        // Their socket ID has been updated, but UUID remains
        if(typeof UserIPs[USER_IP][(ConnectionsPerIP[USER_IP] - 1)] == 'undefined'){
          //  This is a new user on the same IP as someone else that has previously used STORY
          // This is now this user's UUID until reset
          UserIPs[USER_IP][(ConnectionsPerIP[USER_IP] - 1)] = [ITERATIVE_UUID, socket.id, Date.now()];
        } else { // This is an existing user on the network
          var ITER_ADDR = (ConnectionsPerIP[USER_IP] - 1);
          for(var i=0; i<UserIPs[USER_IP].length; i++){
            // iterate through holes in this IP's array, and fill the foremost one;
            //    This is EXTREMELY NOT a bulletproof strategy to keep users on the same network
            //    in the same order, but it's better than nothing for the time being.
            if(typeof UserObject[UserIPs[USER_IP][i][1]] == 'undefined'){
              ITER_ADDR = i; // The earliest user in the list to disconnect gets their place in line
              break;
            }
          }
          UserIPs[USER_IP][ITER_ADDR][1] = socket.id; 
          UserIPs[USER_IP][ITER_ADDR][2] = Date.now();
          This_UID = UserIPs[USER_IP][ITER_ADDR][0];
          Do_not_iterate_UUID = true;
          rePrefix = 're';
        }
      }
      UserObject[socket.id] = [socket, This_UID, '', USER_IP]; // Add user object
      var GAME_MODE_NOW = STORY_MODE; // In an active game in either playing state or titling state
      if(Date.now() < STORY_ACTIVATE_TIME){
        GAME_MODE_NOW = 1; // Cutscene
      }
      var TUSERDATA = getFullUserdata();
      socket.emit('c', [  WHICH_STORY,
                          STORY, 
                          VERSION, 
                          This_UID, 
                          GAME_MODE_NOW, 
                          [0, TUSERDATA], 
                          [STORY_TITLE, STORY_TOP_CONTRIBUTORS], 
                          STORY_ACTIVATE_TIME,
                          TITLE_END_TIME
                       ]);
      socket.broadcast.emit('J', [This_UID]); // emit to all but joiner that a new client has joined
      console.log('O--> User ' + socket.id + ' (UUID '+This_UID+') '+rePrefix+'connected (' + currentlyOnline() + ' connected)');
      if(Do_not_iterate_UUID == false){
        ITERATIVE_UUID++; // iterate UUID list if this is a unique user
      }
    }



    //  On client disconnecting from server for any reason
    socket.on("disconnect", (reason) => {
      if(typeof UserObject[socket.id] != 'undefined'){
        ConnectionsPerIP[UserObject[socket.id][3]] = (parseInt(ConnectionsPerIP[UserObject[socket.id][3]]) - 1);
        var DISCONNECTED_USER = [socket.id, parseInt(UserObject[socket.id][1])];
        socket.broadcast.emit('L', [DISCONNECTED_USER[1]]); // emit to all but joiner that this client left
        delete UserObject[socket.id];
        // UserList.splice(UserList.findIndex(elem => elem === USER), 1);
        console.log('X<-- User ' + DISCONNECTED_USER[0] + ' (UUID '+DISCONNECTED_USER[1]+') disconnected (' + currentlyOnline() + ' connected)');
      } else {
        console.log('X<-- Unknown user disconnected (likely spinner)');
      }
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

        if(SERVER_INITIALIZED == true){

          if(STORY.length < 100 || STORY_MODE == 2){ // Accepts when active story, or title time

            try{
              if (typeof word === 'string' || word instanceof String){
                CLEANWORD = HTMLcleanString(word); // if user submitted a string, clean it first
              } // otherwise, do nothing; the CLEANWORD string will be empty, and therefore will fail
            } catch (e){
              console.log('Word error caught (possibly malicious submission): ', e);
            }

            var WaitListInd = WaitList.findIndex(elem => elem[0] === socket.id);
            if(WaitListInd == -1 || STORY_MODE == 2){ // If user is not on the waitlist (except titling),

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
                  if(STORY.length < 100){
                    STORY.push(WORD_OBJECT);
                    socket.broadcast.emit('+', [WORD_OBJECT]);
                    socket.emit('+', [WORD_OBJECT, WaitlistedFor]);
                    console.log('UUID ' + UserObject[socket.id][1] + ':  ' + CLEANWORD);
                    UserObject[socket.id][2] = '';

                    //  if story reaches 100 words, emit the Title message, and begin Finishing
                    if(STORY.length == 100){
                      //  Submit story to Chicken HQ, then on successful submission, start next game
                      console.log('>>> Story completed, designating the titling process (20 sec!)...');
                      STORY_TOP_CONTRIBUTORS = determineTopContributors();
                      console.log('Top contributors:'); console.log(STORY_TOP_CONTRIBUTORS);
                      STORY_MODE = 2;
                      TITLE_END_TIME = (Date.now() + 20000);
                      io.emit('t', [STORY_TOP_CONTRIBUTORS, TITLE_END_TIME]);

                      //  in case the title is not determined in 25 seconds, auto-submit regardless
                      var verification = JSON.parse(JSON.stringify({storyNumber: TIMEOUT_ELAPSE_CHECK_NUM}));
                      var verf = verification.storyNumber;
                      setTimeout(timeoutSubmission, 20000, verf);
                    }

                  } else { // Add to the title
                    if(STORY_TOP_CONTRIBUTORS.includes(parseInt(UserObject[socket.id][1]))){
                      //  Can submit to the title; Top contributor
                      STORY_TITLE.push(WORD_OBJECT);
                      io.emit('s', [WORD_OBJECT]);
                      console.log('UUID ' + UserObject[socket.id][1] + ':  ' + CLEANWORD);
                      UserObject[socket.id][2] = '';
                      var STC_IND = STORY_TOP_CONTRIBUTORS.indexOf(UserObject[socket.id][1]);
                      STORY_TOP_CONTRIBUTORS.splice(STC_IND, 1); // Remove user from title contribution

                      if(STORY_TOP_CONTRIBUTORS.length == 0){ //  No titlers remain: Submit story
                        console.log('>>> Titling completed, submitting story...');
                        STORY_MODE = 0;
                        submitStory(io);
                      }
                    } else { // User is not included in the title creation process
                      socket.emit('r', [5, 0]);
                    }
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
          } else { // story is 100 words or longer
            socket.emit('r', [4, undefined]);
          }
        } else { // Server is not yet fully initialized
          if(STORY_INDEX_RETRIEVED == false){
            socket.emit('r', [3, undefined]); // The last Story index has not yet been retrieved
          }
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
const deadusers = schedule.scheduleJob('0 0 * * * *', function(){ // Every minute (agressive downspin...)
    console.log('Re-sessioning old users...');
    cleanUsers();
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