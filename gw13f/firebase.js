// Firebase setup shared by index.html (via competition.js) and leaderboard.html.
// This config is not secret: it only names the project. Access is controlled by
// the Firestore security rules (see firestore.rules, pasted into the Firebase console).
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import * as fs from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjgqWhNL9EVJMBT6yDNLBYoWUythnCPrc",
  authDomain: "gw13f-competition.firebaseapp.com",
  projectId: "gw13f-competition",
  storageBucket: "gw13f-competition.firebasestorage.app",
  messagingSenderId: "504138515695",
  appId: "1:504138515695:web:e49678011bfba728eb871a",
};

export const app = initializeApp(firebaseConfig);
export const db = fs.getFirestore(app);
export { fs };

// Google accounts allowed to start/stop/create competitions.
// Must match the list in firestore.rules (the rules are what actually enforce it).
export const ADMIN_EMAILS = ["mae3260mc@gmail.com"];

// Data layout:
//   control/state                      { active, compId, label, updatedAt }  - the competition students submit to
//   competitions/{compId}              { label, createdAt }
//   competitions/{compId}/runs/{auto}  { team, steer, Ki, Kp, Kd, speed, KiV, KpV, V, time, maxErr, createdAt }
