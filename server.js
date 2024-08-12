const mediasoup = require("mediasoup");
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");
const EVENT = require("./constants/events");

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Define the structures for your data
let worker;
let rooms = {};
let peers = {};
let transports = [];
let producers = [];
let consumers = [];

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 4000,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

createWorker();

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];
io.on(EVENT.CONNECTION, async (socket) => {
  console.log("New connection : ", socket.id);
  socket.emit(EVENT.CONNECTION_SUCCESS, {
    socketId: socket.id,
  });

  const removeItems = (items, socketId, type) => {
    items.forEach((item) => {
      if (item.socketId === socketId) {
        item[type].close();
      }
    });
    items = items.filter((item) => item.socketId !== socketId);

    return items;
  };

  socket.on(EVENT.DISCONNECT, () => {
    console.log("peer disconnected");
    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");

    const { roomName } = peers[socket.id];
    delete peers[socket.id];

    rooms[roomName] = {
      router: rooms[roomName].router,
      peers: rooms[roomName].peers.filter((socketId) => socketId !== socket.id),
    };
  });

  socket.on(EVENT.JOIN_ROOM, async ({ roomName, name }, callback) => {
    const router1 = await createRoom(roomName, socket.id);

    peers[socket.id] = {
      socket,
      roomName,
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: name || "unknown",
        isAdmin: false,
      },
    };

    const rtpCapabilities = router1.rtpCapabilities;
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName, socketId) => {
    let router1;
    let roomPeers = [];

    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      roomPeers = rooms[roomName].peers || [];
    } else {
      router1 = await worker.createRouter({ mediaCodecs });
    }

    console.log(`Router ID: ${router1.id}`, roomPeers.length);

    rooms[roomName] = {
      router: router1,
      peers: [...roomPeers, socketId],
    };

    return router1;
  };

  socket.on(EVENT.CREATE_WEB_RTC_TRANSPORT, async ({ consumer }, callback) => {
    const roomName = peers[socket.id].roomName;
    const router = rooms[roomName].router;

    createWebRtcTransport(router).then(
      (transport) => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });

        addTransport(transport, roomName, consumer);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  const addTransport = (transport, roomName, consumer) => {
    transports = [
      ...transports,
      { socketId: socket.id, transport, roomName, consumer },
    ];

    peers[socket.id].transports = [
      ...peers[socket.id].transports,
      transport.id,
    ];
  };

  const addProducer = (producer, roomName, peerDetails) => {
    producers = [
      ...producers,
      { socketId: socket.id, producer, roomName, peerDetails },
    ];

    peers[socket.id].producers = [...peers[socket.id].producers, producer.id];
  };

  const addConsumer = (roomName, consumer) => {
    if (!consumer) return;
    consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

    peers[socket.id].consumers = [...peers[socket.id].consumers, consumer.id];
  };

  socket.on(EVENT.GET_PRODUCERS, (callback) => {
    const { roomName } = peers[socket.id];

    let producerList = [];

    console.log("___________Peoplee in the room_____________________");
    producers.forEach((producerData, index) => {
      console.log(index + 1 + ". " + producerData.peerDetails.name);
      if (
        producerData.socketId !== socket.id &&
        producerData.roomName === roomName
      ) {
        producerList = [
          ...producerList,
          {
            producerID: producerData.producer.id,
            name: producerData.peerDetails.name,
          },
        ];
      }
    });

    callback(producerList);
  });

  const informConsumers = (roomName, socketId, id, peerDetails) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        const producerSocket = peers[producerData.socketId].socket;
        producerSocket.emit(EVENT.NEW_PRODUCER, {
          producerID: id,
          name: peerDetails.name,
        });
      }
    });
  };

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(
      (transport) => transport.socketId === socketId && !transport.consumer
    );
    return producerTransport.transport;
  };

  socket.on(EVENT.TRANSPORT_CONNECT, ({ dtlsParameters }) => {
    console.log("DTLS PARAMS... ", { dtlsParameters });
    getTransport(socket.id).connect({ dtlsParameters });
  });

  socket.on(
    EVENT.TRANSPORT_PRODUCE,
    async ({ kind, rtpParameters, appData }, callback) => {
      const producer = await getTransport(socket.id).produce({
        kind,
        rtpParameters,
      });

      const { roomName, peerDetails } = peers[socket.id];

      addProducer(producer, roomName, peerDetails);

      informConsumers(roomName, socket.id, producer.id, peerDetails);

      console.log("Producer ID: ", producer.id, producer.kind);

      producer.on("transportclose", () => {
        console.log("transport for this producer closed");
        producer.close();
      });

      callback({
        id: producer.id,
        producersExist: producers.length > 1 ? true : false,
      });
    }
  );

  socket.on(
    EVENT.TRANSPORT_RECV_CONNECT,
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      const consumerTransport = transports.find(
        (transportData) =>
          transportData.consumer &&
          transportData.transport.id === serverConsumerTransportId
      )?.transport;
      if (consumerTransport)
        await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on(
    EVENT.CONSUME,
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback
    ) => {
      try {
        const { roomName } = peers[socket.id];
        const router = rooms[roomName].router;
        const consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id === serverConsumerTransportId
        )?.transport;

        if (
          router.canConsume({ producerId: remoteProducerId, rtpCapabilities })
        ) {
          const consumer = await consumerTransport?.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer?.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer?.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit(EVENT.PRODUCER_CLOSED, { remoteProducerId });

            consumerTransport?.close();
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport?.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id
            );
          });

          addConsumer(roomName, consumer);

          const params = {
            id: consumer?.id,
            producerId: remoteProducerId,
            kind: consumer?.kind,
            rtpParameters: consumer?.rtpParameters,
            serverConsumerId: consumer?.id,
          };

          callback({ params });
        }
      } catch (error) {
        console.log(error?.message);
        callback({
          params: {
            error: error.message,
          },
        });
      }
    }
  );

  socket.on(EVENT.CONSUMER_RESUME, async ({ serverConsumerId }) => {
    console.log("consumer resume");
    const consumerData = consumers.find(
      (consumerData) => consumerData.consumer.id === serverConsumerId
    );
    if (consumerData) await consumerData.consumer.resume();
  });
});

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: process.env.ANNOUNCED_IP,
            announcedIp: process.env.ANNOUNCED_IP,
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      const transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};
