# frozen_string_literal: true

require "stringio"

module CRP56
  class Payload
    attr_reader :header, :body, :hmac_tag

    def initialize(header:, body:, hmac_tag: nil)
      raise ArgumentError, "header cannot be nil." if header.nil?
      raise ArgumentError, "body cannot be nil." if body.nil?

      @header = header
      @body = body
      @hmac_tag = hmac_tag
    end

    def hmac_enabled?
      header.hmac_enabled?
    end

    def to_bytes
      io = StringIO.new("".b, "w+b")
      header.write_to(io)
      io.write(body)
      io.write(hmac_tag) if hmac_enabled? && hmac_tag

      io.string
    end

    def bytes_without_hmac
      io = StringIO.new("".b, "w+b")
      header.write_to(io)
      io.write(body)
      io.string
    end

    def self.from_bytes(data)
      raise ArgumentError, "Payload data cannot be nil or empty." if data.nil? || data.empty?

      io = StringIO.new(data, "rb")
      header = Header.read_from(io)

      if header.hmac_enabled?
        if data.bytesize < Header::HMAC_TAG_LENGTH
          raise InvalidPayloadError, "Payload is too short to contain HMAC data."
        end

        body_length = data.bytesize - io.pos - Header::HMAC_TAG_LENGTH
        if body_length.negative?
          raise InvalidPayloadError, "Payload body length is invalid."
        end

        body = io.read(body_length)
        hmac_tag = io.read(Header::HMAC_TAG_LENGTH)

        if body.nil? || body.bytesize != body_length
          raise InvalidPayloadError, "Unexpected end of payload while reading body."
        end

        if hmac_tag.nil? || hmac_tag.bytesize != Header::HMAC_TAG_LENGTH
          raise InvalidPayloadError, "Unexpected end of payload while reading HMAC tag."
        end

        new(header: header, body: body, hmac_tag: hmac_tag)
      else
        body = io.read || "".b
        new(header: header, body: body, hmac_tag: nil)
      end
    end
  end
end