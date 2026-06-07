# frozen_string_literal: true

module CRP56
  class Error < StandardError; end
  class ConfigError < Error; end
  class PhraseStoreError < Error; end
  class InvalidPayloadError < Error; end
  class IntegrityError < Error; end
  class DecryptionError < Error; end
end

