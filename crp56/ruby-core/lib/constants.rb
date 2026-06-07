# frozen_string_literal: true

# frozen_string_literal: true

module CRP56
  module Constants
    MAGIC = "CRP56".b
    VERSION = 0x01

    AES_KEY_SIZE = 32
    AES_BLOCK_SIZE = 16
    DEFAULT_SALT_SIZE = 16
    DEFAULT_SHARD_PLAIN_SIZE = 64 * 1024
    PBKDF2_ITERATIONS = 200_000

    KEY_PHRASE_SLOTS = 6
    DEFAULT_FILE_EXTENSION = ".crp56"

    COMPRESSION_NONE = 0x00
    COMPRESSION_ZSTD = 0x01
    COMPRESSION_LZ4 = 0x02
  end

  class Config
    attr_accessor :shard_plain_size, :salt_size, :kdf_iterations,
                  :use_hmac, :use_compression, :compression_mode

    def initialize
      @shard_plain_size = Constants::DEFAULT_SHARD_PLAIN_SIZE
      @salt_size = Constants::DEFAULT_SALT_SIZE
      @kdf_iterations = Constants::PBKDF2_ITERATIONS
      @use_hmac = true
      @use_compression = true
      @compression_mode = Constants::COMPRESSION_ZSTD
    end

    def validate!
      raise ArgumentError, "Shard size must be positive." unless shard_plain_size.positive?
      raise ArgumentError, "Salt size must be positive." unless salt_size.positive?
      raise ArgumentError, "KDF iterations must be positive." unless kdf_iterations.positive?

      valid_modes = [
        Constants::COMPRESSION_NONE,
        Constants::COMPRESSION_ZSTD,
        Constants::COMPRESSION_LZ4
      ]

      return if valid_modes.include?(compression_mode)

      raise ArgumentError, format("Unknown compression mode: 0x%02X", compression_mode)
    end
  end
end