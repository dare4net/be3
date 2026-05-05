const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy_client_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy_client_secret',
    callbackURL: '/auth/google/callback',
    passReqToCallback: true 
  },
  function(req, accessToken, refreshToken, profile, cb) {
    // Pass profile to the route handler which handles finding/creating the user
    return cb(null, profile);
  }
));

module.exports = passport;
