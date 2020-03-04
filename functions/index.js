// eslint-disable-next-line
const functions = require('firebase-functions');

/**
 * Initiate a recursive delete of documents at a given path.
 * 
 * The calling user must be authenticated and have the custom "admin" attribute
 * set to true on the auth token.
 * 
 * This delete is NOT an atomic operation and it's possible
 * that it may fail after only deleting some documents.
 * 
 * @param {string} data.path the document or collection path to delete.
 */
exports.recursiveDelete = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '2GB'
  })
  .https.onCall((data, context) => {
    const path = data.path;
    console.log(
      `User ${context.auth.uid} has requested to delete path ${path}`
    );

    // only require admin if we aren't closing a room
    if (path.length !== ('/rooms/'.length + 20)) {
        // Only allow admin users to execute this function.
        if (!(context.auth && context.auth.token && context.auth.token.admin)) {
            throw new functions.https.HttpsError(
            'permission-denied',
            'Must be an administrative user to initiate delete.'
            );
        }
    }

    // Run a recursive delete on the given document or collection path.
    // The 'token' must be set in the functions config, and can be generated
    // at the command line by running 'firebase login:ci'.
    // eslint-disable-next-line
    return firebase_tools.firestore
      .delete(path, {
        project: process.env.GCLOUD_PROJECT,
        recursive: true,
        yes: true,
        token: functions.config().fb.token
      })
      .then(() => {
        return {
          path: path 
        };
      });
  });
