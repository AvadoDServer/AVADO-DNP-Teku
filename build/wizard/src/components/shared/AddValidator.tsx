import {
  faAngleDown,
  faAngleUp,
  faEye,
  faEyeSlash,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";
import { RestApi } from "./RestApi";

interface Props {
  updateValidators: () => void;
  api: RestApi;
}

type result = {
  status: "imported" | "duplicate" | "error" | null;
  message: string;
};

type PassWordFieldType = "text" | "password";

const AddValidator = ({ updateValidators, api }: Props) => {
  const [keyStoreFiles, setKeyStoreFiles] = React.useState<File[]>([]);
  const [password, setPassword] = React.useState<string>("");
  const [passwordFieldType, setPasswordFieldType] =
    React.useState<PassWordFieldType>("password");
  const [passwordFieldIcon, setPasswordFieldIcon] = React.useState(faEyeSlash);
  const [slashingProtectionFile, setSlashingProtectionFile] =
    React.useState<File | null>();
  const [addButtonEnabled, setAddButtonEnabled] = React.useState(false);
  const [result, setResult] = React.useState<result>({
    status: null,
    message: "",
  });
  const [isUploading, setIsUploading] = React.useState(false);

  const [collapsed, setCollapsed] = React.useState(true);

  const addValidator = async () => {
    if (!keyStoreFiles || keyStoreFiles.length === 0) {
      console.log("Keystore files not set");
      setResult({
        status: "error",
        message: "Please select at least one keystore file",
      });
      return;
    }

    setIsUploading(true);
    try {
      const createMessage = async () => {
        const keystores = await Promise.all(
          keyStoreFiles.map((f: File) => f.text()),
        );
        const slashingProtection = slashingProtectionFile
          ? await slashingProtectionFile.text()
          : null;
        return {
          keystores: keystores,
          passwords: keystores.map(() => password), // same password for all
          ...(slashingProtection && {
            slashing_protection: slashingProtection,
          }),
        };
      };

      const message = await createMessage();
      console.log(message);

      api.post(
        "/keymanager/eth/v1/keystores",
        message,
        (res) => {
          // https://ethereum.github.io/keymanager-APIs/#/Local%20Key%20Manager/ImportKeystores
          const results: Array<{ status: string; message?: string }> =
            res?.data?.data || [];
          let imported = 0,
            duplicate = 0,
            errors = 0;
          const errorMessages: string[] = [];
          results.forEach((r) => {
            switch (r.status) {
              case "imported":
                imported++;
                break;
              case "duplicate":
                duplicate++;
                break;
              case "error":
              default:
                errors++;
                if (r.message) errorMessages.push(r.message);
                break;
            }
          });

          if (errors > 0) {
            setResult({
              status: "error",
              message: `Imported ${imported}, ${duplicate} duplicate, ${errors} error(s). ${errorMessages[0] ? errorMessages[0] : ""}`,
            });
          } else if (duplicate > 0) {
            setResult({
              status: "duplicate",
              message: `Imported ${imported}, ${duplicate} duplicate.`,
            });
          } else {
            setResult({
              status: "imported",
              message: `Successfully imported ${imported} validator(s).`,
            });
          }
          updateValidators();
          setIsUploading(false);
        },
        (e) => {
          console.log(e);
          setResult({
            status: "error",
            message: e.message + ". Please check the input files",
          });
          setIsUploading(false);
        },
      );
    } catch (e: any) {
      console.log(e);
      setResult({
        status: "error",
        message: e.message + ". Please check the input files",
      });
      setIsUploading(false);
    }
  };

  React.useEffect(() => {
    setAddButtonEnabled(!!password && keyStoreFiles.length > 0 && !isUploading);
  }, [keyStoreFiles, password, isUploading]);

  const getResultTag = () => {
    switch (result.status) {
      case "duplicate":
        return "is-warning";
      case "error":
        return "is-danger";
      default:
        return "is-success";
    }
  };

  const toggleViewPassword = () => {
    const currentType = passwordFieldType;
    setPasswordFieldType(currentType === "password" ? "text" : "password");
    setPasswordFieldIcon(currentType === "password" ? faEye : faEyeSlash);
  };

  return (
    <div>
      <section className="section">
        <div className="container">
          <div className="card has-text-black">
            <header
              className="card-header"
              onClick={() => setCollapsed(!collapsed)}
            >
              <p className="card-header-title">
                Add validator (batch import supported)
              </p>
              <div className="card-header-icon card-toggle">
                <FontAwesomeIcon icon={collapsed ? faAngleDown : faAngleUp} />
              </div>
            </header>
            <div className={"card-content" + (collapsed ? " is-hidden" : "")}>
              <div className="content">
                <div className="field is-horizontal">
                  <label className="field-label has-text-black">
                    Keystore files (required):
                  </label>
                  <div className="field-body">
                    <div className="file has-name">
                      <label className="file-label">
                        <input
                          className="file-input"
                          type="file"
                          name="keystore"
                          id="keystore"
                          multiple
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setKeyStoreFiles(
                              e.target?.files ? Array.from(e.target.files) : [],
                            )
                          }
                        />
                        <span className="file-cta">
                          <span className="file-icon">
                            <FontAwesomeIcon icon={faUpload} />
                          </span>
                          <span className="file-label">
                            Choose keystore file(s)…
                          </span>
                        </span>
                        <span className="file-name">
                          {keyStoreFiles.length > 0
                            ? `${keyStoreFiles[0].name}${keyStoreFiles.length > 1 ? ` (+${keyStoreFiles.length - 1} more)` : ""}`
                            : "No files uploaded"}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="field has-addons">
                  <label className="field-label has-text-black">
                    Password (required):
                  </label>
                  <div className="field-body">
                    <div className="control">
                      <input
                        className="input has-text-black"
                        type={passwordFieldType}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setPassword(e.target.value);
                        }}
                      />
                    </div>
                    <div className="control">
                      {/* eslint-disable-next-line */}
                      <a onClick={toggleViewPassword} className="button">
                        <FontAwesomeIcon
                          className="icon is-small is-right avadoiconpadding"
                          icon={passwordFieldIcon}
                        />
                      </a>
                    </div>
                  </div>
                </div>
                <div className="field is-grouped">
                  <label className="field-label has-text-black">
                    Slashing protection (optional):
                  </label>
                  <div className="field-body">
                    <div className="file has-name">
                      <label className="file-label">
                        <input
                          className="file-input"
                          type="file"
                          name="slashing"
                          id="slashing"
                          onChange={(e) =>
                            setSlashingProtectionFile(e.target?.files?.item(0))
                          }
                        />
                        <span className="file-cta">
                          <span className="file-icon">
                            <FontAwesomeIcon icon={faUpload} />
                          </span>
                          <span className="file-label">
                            Choose slashing protection file…
                          </span>
                        </span>
                        <span className="file-name">
                          {slashingProtectionFile
                            ? slashingProtectionFile.name
                            : "No file uploaded"}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="field is-grouped">
                  <label className="field-label has-text-black">
                    {/* Left empty for spacing*/}
                  </label>
                  <div className="field-body">
                    <div className="control">
                      <button
                        className="button is-link"
                        onClick={addValidator}
                        disabled={!addButtonEnabled}
                      >
                        {isUploading ? "Adding…" : "Add validator(s)"}
                      </button>
                    </div>
                    {result.message && (
                      <p className={"tag " + getResultTag()}>
                        {result.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AddValidator;
