# frozen_string_literal: true

module CRP56
  class Error < StandardError; end
  class InvalidHeaderError < Error; end
  class InvalidPayloadError < Error; end
  class IntegrityError < Error; end
  class DecryptionError < Error; end
  class CompressionError < Error; end
  class PhraseStoreError < Error; end
end# frozen_string_literal: true

