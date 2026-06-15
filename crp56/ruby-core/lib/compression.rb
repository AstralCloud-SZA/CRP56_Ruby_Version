# frozen_string_literal: true

begin
  require "zstd-ruby"
rescue LoadError
  raise CompressionError, "Zstd support is not available. Install the zstd-ruby gem."
end

begin
  require "lz4-ruby"
rescue LoadError
  LZ4_AVAILABLE = false
else
  LZ4_AVAILABLE = true
end

module CRP56
  ##
  # Compression helpers used by the CRP56 crypto layer.
  #
  # Zstd is the default compression backend. LZ4 is optional and will only be
  # used when the gem is installed and exposes a compatible API.
  module Compression
    module_function

    ##
    # Compresses +data+ using the selected compression mode.
    #
    # @param data [String] binary string to compress
    # @param compression_mode [Integer] one of the Constants::COMPRESSION_* values
    # @return [String] compressed or unmodified data
    def compress(data, compression_mode)
      raise ArgumentError, "Data cannot be nil." if data.nil?

      case compression_mode
      when Constants::COMPRESSION_NONE
        data
      when Constants::COMPRESSION_ZSTD
        Zstd.compress(data)
      when Constants::COMPRESSION_LZ4
        raise CompressionError, "LZ4 compression is not available in this Ruby environment." unless LZ4_AVAILABLE

        compress_lz4(data)
      else
        raise CompressionError, format("Unsupported compression mode: 0x%02X", compression_mode)
      end
    rescue CompressionError
      raise
    rescue StandardError => e
      raise CompressionError, "Compression failed: #{e.message}"
    end

    ##
    # Decompresses +data+ using the selected compression mode.
    #
    # @param data [String] binary string to decompress
    # @param compression_mode [Integer] one of the Constants::COMPRESSION_* values
    # @return [String] decompressed or unmodified data
    def decompress(data, compression_mode)
      raise ArgumentError, "Data cannot be nil." if data.nil?

      case compression_mode
      when Constants::COMPRESSION_NONE
        data
      when Constants::COMPRESSION_ZSTD
        Zstd.decompress(data)
      when Constants::COMPRESSION_LZ4
        raise CompressionError, "LZ4 compression is not available in this Ruby environment." unless LZ4_AVAILABLE

        decompress_lz4(data)
      else
        raise CompressionError, format("Unsupported compression mode: 0x%02X", compression_mode)
      end
    rescue CompressionError
      raise
    rescue StandardError => e
      raise CompressionError, "Decompression failed: #{e.message}"
    end

    ##
    # Returns true when LZ4 is available in the current Ruby environment.
    def lz4_available?
      LZ4_AVAILABLE
    end

    ##
    # Compresses data with the installed LZ4 gem API.
    #
    # Supports the classic lz4-ruby interface:
    # - LZ4.compress
    # - LZ4.compressHC
    def compress_lz4(data)
      if defined?(LZ4) && LZ4.respond_to?(:compress)
        LZ4.compress(data)
      elsif defined?(LZ4) && LZ4.respond_to?(:compressHC)
        LZ4.compressHC(data)
      else
        raise CompressionError, "LZ4 gem loaded, but no supported compress API was found."
      end
    end
    private_class_method :compress_lz4

    ##
    # Decompresses data with the installed LZ4 gem API.
    #
    # Supports the classic lz4-ruby interface:
    # - LZ4.uncompress
    # - LZ4.decompress
    def decompress_lz4(data)
      if defined?(LZ4) && LZ4.respond_to?(:uncompress)
        LZ4.uncompress(data)
      elsif defined?(LZ4) && LZ4.respond_to?(:decompress)
        LZ4.decompress(data)
      else
        raise CompressionError, "LZ4 gem loaded, but no supported decompress API was found."
      end
    end
    private_class_method :decompress_lz4
  end
end