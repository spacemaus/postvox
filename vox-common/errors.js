/**
 * Error classes.
 */


function ClientError(message) {
  this.name = 'ClientError';
  this.message = message;
  this.statusCode = 400;
}
ClientError.prototype = new Error;
exports.ClientError = ClientError;


function NotFoundError(message) {
  this.name = 'NotFoundError';
  this.message = message;
  this.statusCode = 404;
}
NotFoundError.prototype = new Error;
exports.NotFoundError = NotFoundError;


function AuthenticationError(message) {
  this.name = 'AuthenticationError';
  this.message = message;
  this.statusCode = 403;
}
AuthenticationError.prototype = new ClientError;
exports.AuthenticationError = AuthenticationError;


function ConstraintError(message) {
  this.name = 'ConstraintError';
  this.message = message;
  this.statusCode = 409;
}
ConstraintError.prototype = new ClientError;
exports.ConstraintError = ConstraintError;



function DuplicateTransactionError(message) {
  this.name = 'DuplicateTransactionError';
  this.message = message;
  this.statusCode = 409;
}
DuplicateTransactionError.prototype = new ClientError;
exports.DuplicateTransactionError = DuplicateTransactionError;


function ServerError(message) {
  this.name = 'ServerError';
  this.message = message;
  this.statusCode = 500;
}
ServerError.prototype = new Error;
exports.ServerError = ServerError;
