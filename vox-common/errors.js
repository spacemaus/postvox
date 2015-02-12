/**
 * Error classes.
 */

var util = require('util');


function ClientError(message) {
  this.name = 'ClientError';
  this.message = message;
  this.statusCode = 400;
}
util.inherits(ClientError, Error);
exports.ClientError = ClientError;


function NotFoundError(message) {
  this.name = 'NotFoundError';
  this.message = message;
  this.statusCode = 404;
}
util.inherits(NotFoundError, Error);
exports.NotFoundError = NotFoundError;


function AuthenticationError(message) {
  this.name = 'AuthenticationError';
  this.message = message;
  this.statusCode = 403;
}
util.inherits(AuthenticationError, ClientError);
exports.AuthenticationError = AuthenticationError;


function ConstraintError(message) {
  this.name = 'ConstraintError';
  this.message = message;
  this.statusCode = 409;
}
util.inherits(ConstraintError, ClientError);
exports.ConstraintError = ConstraintError;



function DuplicateTransactionError(message) {
  this.name = 'DuplicateTransactionError';
  this.message = message;
  this.statusCode = 409;
}
util.inherits(DuplicateTransactionError, ClientError);
exports.DuplicateTransactionError = DuplicateTransactionError;


function ServerError(message) {
  this.name = 'ServerError';
  this.message = message;
  this.statusCode = 500;
}
util.inherits(ServerError, Error);
exports.ServerError = ServerError;
