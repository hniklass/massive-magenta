const net = require('net');
const colors = require('colors/safe');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const config = require('config');
const { TcpSocket } = require('./tcp_socket');
const { httpResponses, defaultHeaders } = require('../utils/http_utils');

const fsAsync = fs.promises;
/**
 * @class
 * @classdesc HTTPServer is a custom implementation of a server to handle the HTTP protocol.
 * It implements native TCP sockets through Node's Net class.
 */
class HttpServer {
  /**
   * @private
   * @description Holds the local IP address.
   */
  #host;

  /**
   * @private
   * @description Holds the local port number.
   */
  #port;

  /**
   * @private
   * @description Holds the server instance.
   */
  #server;

  /**
   * @private
   * @description Holds colored text to be used in console logs.
   */
  #str = {
    server: colors.yellow('[SERVER]'),
    client: colors.brightRed('[CLIENT]'),
  };

  /**
   * @function
   * @param {String} [host="127.0.0.1"] - Local address where the server will be run from.
   * @param {Number} [port=8124] - Local port where the server will be run from.
   * @returns {Object} A new HTTPServer instance.
   * @example
   * // Initializing a new server instance.
   * const server = new HTTPServer();
   * server.init();
   */
  constructor(host = config.get('host'), port = config.get('port')) {
    this.#host = process.env.HOST || host;
    this.#port = process.env.PORT || port;
  }

  /**
   * @function
   * @description Closes the server connection and disconnects all sockets.
   * @returns {Void} N/A.
   */
  close = () => {
    this.#server.close(() => console.log('All connections finished. Bye!'));
  }

  /**
   * @private
   * @function
   * @description This function gets called once the socket half-closes the TCP connection.
   * @param {Object} socket - The object representing the connected socket.
   * It should be passed by the appropriate event listener.
   * @returns {Void} N/A.
   */
  /* istanbul ignore next */
  #endHandler = (socket) => {
    try {
      socket.internal.destroy();
    } catch (error) {
      console.log(error);
    }

    console.log(`${this.#str.client} (${socket.addr}:${socket.port}) disconnected.`);
  }

  /**
   * @private
   * @function
   * @description Manually destroys the socket connection without triggering the
   * end event handler.
   * @param {Object} socket - The object representing the connected socket.
   * @returns {Void} N/A.
   */
  /* istanbul ignore next */
  #endConnection = (socket) => {
    try {
      socket.internal.destroy();
      console.log(`${this.#str.server} (${socket.addr}:${socket.port}) connection closed.`);
    } catch (error) {
      console.log(error);
    }
  }

  /**
   * @private
   * @function
   * @description Gets the entry line in an HTTP request.
   * @param {String[]} stringData - The array of strings containing the HTTP request.
   * It should be passed down by the appropriate method.
   * @returns {String[]} Returns an array of strings containing the HTTP request
   * method, resource and version.
   */
  /* istanbul ignore next */
  #getEntryLine = (stringData) => stringData[0].split(' ');

  /**
   * @private
   * @function
   * @description Gets the headers from the HTTP request.
   * @param {String[]} stringData - The array of strings containing the HTTP request.
   * It should be passed down by the appropriate method.
   * @returns {Object} Returns an object with all the headers.
   * Non-valid headers are parsed out.
   */
  /* istanbul ignore next */
  #getHeaders = (stringData) => {
    const headersArray = stringData.slice(1, stringData.findIndex((e) => !e));
    const headers = {};

    /* eslint-disable-next-line no-restricted-syntax */
    for (const header of headersArray) {
      const [key, val] = header.split(': ');

      /*
      * Regex makes sure header key doesn't have any number or symbol other than "-".
      */
      if (val && !/[^a-zA-Z-]/g.test(key)) {
        headers[key] = Number(val) || val;
      }
    }

    return headers;
  }

  /**
   * @private
   * @function
   * @description Checks if the resource requested exists and returns it.
   * @param {String} resource - String identifying the directory and resource being fetched.
   * @returns {Promise(Resolved)<Object>} Object containing an HTTP 200 code and
   * the file with its metadata.
   * @returns {Promise(Rejected)<Object>} Object containing an HTTP error code.
   */
  /* istanbul ignore next */
  #getResource = async (resource) => {
    try {
      let resourcePath = resource;

      // Determine if trailing slash and remove it.
      if (resource[resource.length - 1] === '/') {
        resourcePath = resourcePath.slice(0, resourcePath.length - 1);
      }

      // Resolves resource to a full path using the public folder configured.
      const webDir = config.get('web_dir');
      let resolvedPath = path.join(__dirname, `../${webDir}`, resourcePath);

      console.log(resolvedPath);

      // Checks if the resolvePath is within /www.
      const relative = path.relative(path.resolve(__dirname, `../${webDir}`), resolvedPath);
      if (relative && relative.startsWith('..')) {
        return {
          code: 403,
        };
      }

      let stats = await fsAsync.stat(resolvedPath);
      if (stats.isDirectory()) {
        resolvedPath = path.join(resolvedPath, '/index.html');
        stats = await fsAsync.stat(resolvedPath);
      }

      const data = await fsAsync.readFile(resolvedPath, { encoding: 'utf8' });
      const type = mime.contentType(path.extname(resolvedPath));

      return {
        code: 200,
        file: {
          data,
          size: stats.size,
          type,
        },
      };
    } catch (error) {
      console.log(error);

      switch (error.code) {
        case 'EACCES':
        case 'ENOTEMPTY':
        case 'EPERM':
        case 'EEXIST':
          return { code: 400 };

        case 'EISDIR':
          return { code: 403 };

        case 'ENOTDIR':
        case 'ENOENT':
          return { code: 404 };

        case 'EMFILE':
        default:
          return { code: 500 };
      }
    }
  }

  /**
   * @private
   * @function
   * @description Handles a GET HTTP request and returns an appropriate response.
   * @param {Object} socket - The object representing the connected socket.
   * @param {String} resource - String identifying the directory and resource being fetched.
   * @returns {Promise(Resolved)<Object>}
   * The response object including the status line, headers and body.
   */
  /* istanbul ignore next */
  #handleGetMethod = async (resource) => {
    const resourceData = await this.#getResource(resource);

    const getResponse = {
      response: httpResponses[resourceData.code],
      responseCode: resourceData.code,
    };

    if (!resourceData.file) {
      return {
        ...getResponse,
        headers: {
          ...defaultHeaders,
        },
      };
    }

    return {
      ...getResponse,
      headers: {
        ...defaultHeaders,
        'Content-Length': resourceData.file.size,
        'Content-Type': resourceData.file.type,
      },
      body: resourceData.file.data,
    };
  }

  /**
   * @private
   * @function
   * @description Writes the HTTP response to the client and closes the connection.
   * @param {Object} socket - The object representing the connected socket.
   * @param {String} res - The response object generated by the server.
   * @returns {Void} N/A.
   */
  /* istanbul ignore next */
  #writeResponse = (socket, res) => {
    try {
      socket.internal.write(`HTTP/1.0 ${res.responseCode} ${res.response}\r\n`);

      /* eslint-disable-next-line no-restricted-syntax */
      for (const header of Object.keys(res.headers)) {
        socket.internal.write(`${header}: ${res.headers[header]}\r\n`);
      }

      if (res.body) {
        socket.internal.write('\r\n'); // Body separation line.
        socket.internal.write(res.body);
      }

      socket.internal.write('\r\n');
    } catch {
      console.log(`${this.#str.server} Could not write data to (${socket.addr}:${socket.port}).`);
    }

    this.#endConnection(socket);
  }

  /**
   * @private
   * @function
   * @description Handles the request sent from the client.
   * A valid HTTP request must be sent for it to be handled, otherwise an ERROR message
   * will be sent to the client.
   * @param {Object} socket - The object representing the connected socket.
   * It should be passed by the appropriate event listener.
   * @param {Buffer} data - The request received by the server.
   * @returns {Void} N/A.
   */
  /* istanbul ignore next */
  #dataHandler = (socket, data) => {
    try {
      const stringData = data.toString('utf-8').split('\r\n');
      const [method, resource, version] = this.#getEntryLine(stringData);
      const headers = this.#getHeaders(stringData);

      if (!method || !resource || !version || !Object.keys(headers).length) {
        this.#writeResponse(socket, {
          response: 'Bad Request',
          responseCode: 400,
          headers: {
            Server: 'massive-magenta',
          },
        });

        return;
      }

      console.log(`${this.#str.client} (${socket.addr}:${socket.port}) sent data.`);

      switch (method) {
        case 'GET': {
          this.#handleGetMethod(resource).then((res) => {
            console.log(`${this.#str.server} (${socket.addr}) GET => ${res.responseCode}.`);
            this.#writeResponse(socket, res);
          });

          break;
        }
        default: {
          this.#writeResponse(socket, {
            response: 'Bad Request',
            responseCode: 400,
            headers: {
              Server: 'massive-magenta',
            },
          });
        }
      }

      return;
    } catch (error) {
      console.log(colors.brightRed(`(${socket.addr}:${socket.port}) d/c on data listener.`));
      console.log(error);
    }
  }

  /**
   * @private
   * @function
   * @description Creates a new TcpSocket instance and sets up the event listeners.
   * @param {Object} client - The object representing the connected socket.
   * It should be passed by the appropriate event listener.
   * @returns {Void} N/A.
   */
  /* istanbul ignore next */
  #tcpHandler = (client) => {
    const socket = new TcpSocket(client);
    console.log(`${this.#str.client} (${socket.addr}:${socket.port}) connected.`);

    socket.internal.on('end', () => this.#endHandler(socket));
    socket.internal.on('data', (data) => this.#dataHandler(socket, data));
  }

  /**
   * @private
   * @function
   * @description Sets up the TCP listener for the server.
   * @returns {Void} N/A.
   */
  /* istanbul ignore next */
  #listen = () => {
    this.#server.listen(this.#port, this.#host, config.get('backlog_size'), () => {
      console.log(`${this.#str.server} Connected. Listening on ${this.#host}:${this.#port}.`);
    });
  }

  /**
   * @function
   * @description Starts up the server.
   * @param {Function} [listener=#tcpHandler] - The callback to handle new connections.
   * @returns {Object} The server instance.
   */
  init = (listener = this.#tcpHandler) => {
    console.log(colors.yellow(`Initializing TCP server on port ${this.#port}...`));

    this.#server = net.createServer({ allowHalfOpen: true }, listener);
    this.#listen();
    return this.#server;
  }
}

module.exports = { HttpServer };
