# frozen_string_literal: true

require "securerandom"

module CRP56
  ##
  # EmbeddedPhraseStore provides the built-in phrase set used by the backend
  # when embedded secrets are enabled.
  #
  # This store keeps a fixed-size array of phrases in memory and exposes the
  # same basic behaviors as the file-backed phrase store:
  # - fetch a phrase by slot index,
  # - pick a random slot for encryption,
  # - validate that all slots are present and non-empty.
  #
  # The actual embedded phrases are not shown here, but the class assumes they
  # are loaded into +EMBEDDED_PHRASES+ as an array of exactly SLOT_COUNT strings.

  EMBEDDED_PHRASES = [
    "Killer Lord Primordial White",
    "Testarossa Lord Of The underWorld",
    "All Of Creation Seimei Shihai",
    "Jajjimento Genkai Toppa",
    "Jigen Hadan Abisu Anaiareshon",
    "Gurabiti Korapusu Nyukuria Fureimu"
  ].freeze

  class EmbeddedPhraseStore
    SLOT_COUNT = 6

    ##
    # Creates a new embedded phrase store.
    #
    # @param phrases [Array<String>] embedded phrase list
    # The provided array is frozen so the built-in secret set cannot be modified
    # at runtime.
    def initialize(phrases = EMBEDDED_PHRASES)
      @phrases = phrases.freeze
    end

    ##
    # Returns the phrase stored at the requested slot index.
    #
    # @param index [Integer] slot index from 0 to SLOT_COUNT - 1
    # @raise [PhraseStoreError] if the index is invalid or the phrase is blank
    def get_phrase(index)
      validate_index!(index)
      phrase = @phrases[index]
      if phrase.nil? || phrase.strip.empty?
        raise PhraseStoreError, "Embedded phrase at slot #{index} is missing or empty."
      end

      phrase
    end

    ##
    # Picks a random valid slot index.
    #
    # This is used by the crypto layer to select one embedded phrase for a
    # given encryption operation.
    def random_slot_picker
      rand(0...SLOT_COUNT)
    end

    ##
    # Returns true when the embedded phrase set is structurally valid.
    #
    # A valid embedded store must be an Array with exactly SLOT_COUNT non-empty
    # String entries.
    def valid?
      return false unless @phrases.is_a?(Array)
      return false unless @phrases.size == SLOT_COUNT

      @phrases.all? { |p| p.is_a?(String) && !p.strip.empty? }
    end

    ##
    # Raises unless the embedded phrase set is valid.
    #
    # @return [Boolean] true when the store is valid
    def validate!
      raise PhraseStoreError, "Embedded phrase store is invalid." unless valid?
      true
    end

    private

    ##
    # Ensures the requested index is within the valid slot range.
    def validate_index!(index)
      unless index.is_a?(Integer) && index >= 0 && index < SLOT_COUNT
        raise PhraseStoreError, "Phrase index out of range: #{index.inspect}"
      end
    end
  end
end