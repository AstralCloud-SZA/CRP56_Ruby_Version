# frozen_string_literal: true
# frozen_string_literal: true

module CRP56
  class Header
    HMAC_TAG_LENGTH = 32

    attr_accessor :version, :key_slot_index, :flags, :kdf_iterations, :compression_mode, :salt, :total_shards, :last_shard_size

    def initialize
      @version = Constants::VERSION
      @key_slot_index = 0
      @flags = 0
      @kdf_iterations = Constants::PBKDF2_ITERATIONS
      @compression_mode = Constants::COMPRESSION_NONE
      @salt = "".b
      @total_shards = 0
      @last_shard_size = 0
    end

    def hmac_enabled?
      (flags & 0x01) != 0
    end

    def hmac_enabled=(value)
      if value
        self.flags = flags | 0x01
      else
        self.flags = flags & 0xFE
      end
    end

    def write_to(io)
      validate_for_write!(io)

      io.write(Constants::MAGIC)
      io.write([version].pack("C"))
      io.write([key_slot_index].pack("C"))
      io.write([flags].pack("C"))
      io.write([kdf_iterations].pack("V"))
      io.write([compression_mode].pack("C"))
      io.write([salt.bytesize].pack("C"))
      io.write(salt)
      io.write([total_shards].pack("V"))
      io.write([last_shard_size].pack("V"))
    end

    def self.read_from(io)
      raise ArgumentError, "IO cannot be nil." if io.nil?

      header = new

      magic = io.read(Constants::MAGIC.bytesize)
      if magic.nil? || magic.bytesize < Constants::MAGIC.bytesize
        raise InvalidHeaderError, "File is too short to contain valid CRP56 header."
      end

      unless magic == Constants::MAGIC
        raise InvalidHeaderError, "Not a CRP56 file. Expected magic '#{Constants::MAGIC}', got '#{magic}'."
      end

      header.version = read_byte!(io, "version")
      if header.version != Constants::VERSION
        raise InvalidHeaderError, "Unsupported CRP56 version. Expected #{Constants::VERSION}, got #{header.version}."
      end

      header.key_slot_index = read_byte!(io, "key slot index")

      if header.key_slot_index >= Constants::KEY_PHRASE_SLOTS
        raise InvalidHeaderError, "Invalid KeySlotIndex. Must be between 0 and #{Constants::KEY_PHRASE_SLOTS - 1}, got #{header.key_slot_index}."
      end

      header.flags = read_byte!(io, "flags")

      header.kdf_iterations = read_int32_le!(io, "KDF iterations")

      if header.kdf_iterations <= 0
        raise InvalidHeaderError, "Invalid KDF iterations. Must be a positive integer, got #{header.kdf_iterations}."
      end

      header.compression_mode = read_byte!(io, "compression mode")
      valid_modes = [Constants::COMPRESSION_NONE, Constants::COMPRESSION_ZSTD, Constants::COMPRESSION_LZ4]

      unless valid_modes.include?(header.compression_mode)
        raise InvalidHeaderError, format("Invalid CompressionMode. Must be 0x00, 0x01, or 0x02, got 0x%02X.", header.compression_mode)
      end

      salt_length = read_byte!(io, "salt length")
      if salt_length.zero?
        raise InvalidHeaderError, "Salt length cannot be zero."
      end

      header.salt = io.read(salt_length)
      if header.salt.nil? || header.salt.bytesize != salt_length
        got = header.salt ? header.salt.bytesize : 0
        raise InvalidHeaderError,
              "File ended unexpectedly while reading salt. Expected #{salt_length} bytes, got #{got} bytes."
      end

      header.total_shards = read_int32_le!(io, "total shards")
      if header.total_shards <= 0
        raise InvalidHeaderError,
              "Invalid TotalShards. Must be a positive integer, got #{header.total_shards}."
      end

      header.last_shard_size = read_int32_le!(io, "last shard size")
      if header.last_shard_size <= 0
        raise InvalidHeaderError, "Invalid last shard plain size in header."
      end

      header
    end

    private

    def validate_for_write!(io)
      raise ArgumentError, "IO cannot be nil." if io.nil?
      raise InvalidHeaderError, "Salt must be set before writing the header." if salt.nil? || salt.empty?
      raise InvalidHeaderError, "Salt length exceeds maximum of 255 bytes." if salt.bytesize > 255
    end

    def self.read_byte!(io, field_name)
      data = io.read(1)
      if data.nil? || data.bytesize != 1
        raise InvalidHeaderError, "Unexpected end of data while reading #{field_name}."
      end

      data.unpack1("C")
    end

    def self.read_int32_le!(io, field_name)
      data = io.read(4)
      if data.nil? || data.bytesize != 4
        raise InvalidHeaderError, "Unexpected end of data while reading #{field_name}."
      end

      data.unpack1("V")
    end
  end
end
