/**
 * Error classes.
 */

var util = require('util');


function HttpError(statusCode, message) {
  this.statusCode = statusCode;
  this.message = message;
}
util.inherits(HttpError, Error);
exports.HttpError = HttpError;


function ClientError(statusCode, message) {
  this.name = 'ClientError';
  if (arguments.length == 1 && typeof(statusCode) != 'number') {
    message = statusCode;
    statusCode = 400;
  }
  HttpError.call(this, statusCode, message);
}
util.inherits(ClientError, HttpError);
exports.ClientError = ClientError;


function NotFoundError(message) {
  this.name = 'NotFoundError';
  ClientError.call(this, 404, message);
}
util.inherits(NotFoundError, Error);
exports.NotFoundError = NotFoundError;


function AuthenticationError(message) {
  this.name = 'AuthenticationError';
  ClientError.call(this, 403, message);
}
util.inherits(AuthenticationError, ClientError);
exports.AuthenticationError = AuthenticationError;


function ConstraintError(message) {
  this.name = 'ConstraintError';
  ClientError.call(this, 409, message);
}
util.inherits(ConstraintError, ClientError);
exports.ConstraintError = ConstraintError;


function DuplicateTransactionError(message) {
  this.name = 'DuplicateTransactionError';
  ClientError.call(this, 409, message);
}
util.inherits(DuplicateTransactionError, ClientError);
exports.DuplicateTransactionError = DuplicateTransactionError;


function ServerError(message) {
  this.name = 'ServerError';
  HttpError.call(this, 500, message);
}
util.inherits(ServerError, HttpError);
exports.ServerError = ServerError;
