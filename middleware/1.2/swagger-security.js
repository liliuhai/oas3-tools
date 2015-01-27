/*
* The MIT License (MIT)
*
* Copyright (c) 2014 Apigee Corporation
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in
* all copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
* THE SOFTWARE.
*/
'use strict';

var _ = require('lodash');
var async = require('async');
var helpers = require('../helpers');

/**
* Middleware for using Swagger security information to authenticate requests.
*
* This middleware also requires that you use the swagger-metadata middleware before this middleware. It is recommended
* that this middleware is included before swagger-validator and swagger-router. This makes no attempt to work around
* invalid Swagger documents.
*
*
* A SecurityImplementation is essentially middleware must include 2 exported methods:
*   configure (SecurityDefinition)
*   authorize (request, response, SecurityRequirement)
*
* @param {object} [options] - The middleware options
*                 [options.{name}={handler}] - the keys match SecurityDefinition names and the associated values are
*                                              functions that accept the following parameters: (request,
*                                              securityDefinition, scopes, callback) where callback accepts one
*                                              argument - an Error if unauthorized. The Error may include "message",
*                                              "state", and "code" fields to be conveyed to the client in the response
*                                              body and a "headers" field containing an object representing headers
*                                              to be set on the response to the client. In addition, if the Error has
*                                              a statusCode field, the response statusCode will be set to match -
*                                              otherwise, the statusCode will be set to 403.
*
* @returns the middleware function
*/
exports = module.exports = function swaggerSecurityMiddleware (options) {

  var handlers = options || {};

  return function swaggerSecurity (req, res, next) {
    if (!req.swagger || !req.swagger.operation) { return next(); }

    // Global (path level), authorization support is not possible:
    //   Not possible due to https://github.com/swagger-api/swagger-spec/issues/159
    var securityReqs = _.reduce(req.swagger.operation.authorizations, function (arr, authorization, name) {
      var obj = {};

      obj[name] = _.map(authorization, function (scope) {
        return scope.scope;
      });

      return arr.concat(obj);
    }, []);

    if (!securityReqs || securityReqs.length === 0) { return next(); }

    async.map(securityReqs, function(secReq, cb) { // logical OR - any one can allow
      async.map(Object.keys(secReq), function(name, cb) { // logical AND - all must allow
        var secDef = req.swagger.resourceListing.authorizations[name];
        var handler = handlers[name];

        if (!handler) { return cb(new Error('unknown security handler: ' + name)); }

        handler(req, secDef, helpers.getScopeOrAPIKey('1.2', req, secDef, name, secReq), cb);
      }, function (err) {
        // swap normal err and result to short-circuit the logical OR
        if (err) { return cb(undefined, err); }

        cb(new Error('OK'));
      });
    }, function (ok, errors) { // note swapped results
      if (ok && ok.message === 'OK') { return next(); }

      helpers.sendSecurityError(errors[0], res, next);
    });
  };
};
