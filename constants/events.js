const EVENT = {
  CONNECTION: "connection",
  DISCONNECT: "disconnect",
  CONNECTION_SUCCESS: "connection-success",
  JOIN_ROOM: "join-room",
  CREATE_WEB_RTC_TRANSPORT: "create-web-rtc-transport",
  GET_PRODUCERS: "get-proucers",
  TRANSPORT_CONNECT: "transport-connect",
  TRANSPORT_PRODUCE: "transport-produce",
  TRANSPORT_RECV_CONNECT: "transport-recv-connect",
  CONSUME: "consume",
  RESUME: "resume",
  PRODUCER_CLOSED: "producer-closed",
  NEW_PRODUCER: "new-producer",
  CONSUMER_RESUME: "consumer-resume",
};

module.exports = EVENT;
