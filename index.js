'use strict';

var express = require('express');

var routes = {
  'db': require('./lib/routes/db.js'),
  'document': require('./lib/routes/document.js'),
  'attachments': require('./lib/routes/attachments.js')
};

module.exports = function(db) {

  var app = express.Router();

  app.use(function (req, res, next) {
    for (var prop in req.query) {
      try {
        req.query[prop] = JSON.parse(req.query[prop]);
      } catch (e) {}
    }
    next();
  });

  // app.get('/', function (req, res) {
  //   res.status(200).send({'pouchdb-express-router': 'Welcome!'});
  // });
  //
  // app.get('/_session', function (req, res) {
  //   res.status(200).send({
  //     'ok': true,
  //     'userCtx':{"name":null,"roles":["_admin"]}
  //   });
  // });

  routes.db(app, db);
  routes.attachments(app, db);
  routes.document(app, db);

  app.use(function (req, res) {
    res.status(404).send( {
      error: "not_found",
      reason: "missing"
    });
  });

  return app;
};

// Used for testing porpoises
// var PouchDB = require('pouchdb');
// module.exports(PouchDB);
// app.listen(5985);
